import { randomUUID, randomInt } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { parseJpegSize } from '../../core/media/jpeg';
import { parseMp4Meta } from '../../core/media/mp4';
import { mediaSchema, type Media } from '../../schemas/media';
import { IgError } from '../../errors/ig-error';
import {
  ClientSchemaError,
  IgApiError,
  PleaseWaitError,
  RateLimitError,
  FeedbackRequiredError,
  SentryBlockError,
} from '../../errors/api-errors';

const RUPLOAD_HOST = 'https://i.instagram.com';
const TRANSCODE_RETRIES = 6;
const TRANSCODE_DELAY_MS = 2500;

const RETRY_CONTEXT = JSON.stringify({
  num_step_auto_retry: 0,
  num_reupload: 0,
  num_step_manual_retry: 0,
});

export interface PhotoUploadOptions {
  readonly caption?: string;
}

export interface VideoUploadOptions {
  readonly caption?: string;
  /** Overrides the value read from the MP4 when parsing fails or is undesired. */
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newUploadId(): string {
  return String(Date.now());
}

function entityName(uploadId: string): string {
  return `${uploadId}_0_${String(randomInt(1_000_000_000))}`;
}

/** Streams raw bytes to a rupload endpoint, returning the server upload id. */
async function rupload(
  client: PrivateClient,
  kind: 'igphoto' | 'igvideo',
  uploadId: string,
  bytes: Uint8Array,
  entityType: string,
  ruploadParams: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const name = entityName(uploadId);
  const json = await client.request({
    method: 'POST',
    endpoint: `rupload_${kind}`,
    rawUrl: `${RUPLOAD_HOST}/rupload_${kind}/${name}`,
    rawBody: bytes,
    withSignature: false,
    withDefaultData: false,
    headers: {
      'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
      'X-Entity-Type': entityType,
      'X-Entity-Name': name,
      'X-Entity-Length': String(bytes.length),
      'Content-Length': String(bytes.length),
      'Content-Type': 'application/octet-stream',
      Offset: '0',
      'X-FB-Photo-Waterfall-ID': randomUUID(),
      ...extraHeaders,
    },
  });
  return typeof json['upload_id'] === 'string' ? json['upload_id'] : uploadId;
}

/** Uploads JPEG bytes. `mediaType` is '1' for a photo, '2' for a video cover. */
function ruploadPhoto(
  client: PrivateClient,
  jpeg: Uint8Array,
  uploadId: string,
  mediaType: '1' | '2',
  sidecar = false,
): Promise<string> {
  return rupload(client, 'igphoto', uploadId, jpeg, 'image/jpeg', {
    retry_context: RETRY_CONTEXT,
    media_type: mediaType,
    xsharing_user_ids: '[]',
    upload_id: uploadId,
    image_compression: JSON.stringify({ lib_name: 'moz', lib_version: '3.1.m', quality: '80' }),
    ...(sidecar ? { is_sidecar: '1' } : {}),
  });
}

function ruploadVideo(
  client: PrivateClient,
  mp4: Uint8Array,
  uploadId: string,
  meta: { durationMs: number; width: number; height: number },
  sidecar = false,
): Promise<string> {
  return rupload(
    client,
    'igvideo',
    uploadId,
    mp4,
    'video/mp4',
    {
      retry_context: RETRY_CONTEXT,
      media_type: '2',
      xsharing_user_ids: '[]',
      upload_id: uploadId,
      upload_media_duration_ms: String(meta.durationMs),
      upload_media_width: String(meta.width),
      upload_media_height: String(meta.height),
      ...(sidecar ? { is_sidecar: '1' } : {}),
    },
    sidecar ? { 'Segment-Start-Offset': '0', 'Segment-Type': '3' } : {},
  );
}

function parseConfiguredMedia(json: Record<string, unknown>): Media {
  const parsed = mediaSchema.safeParse(json['media']);
  if (!parsed.success) {
    throw new ClientSchemaError(
      'configure response did not match the media schema',
      json['media'],
      {
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
}

function deviceBlock(client: PrivateClient): Record<string, unknown> {
  return {
    manufacturer: client.session.profile.manufacturer,
    model: client.session.profile.model,
    android_version: client.session.profile.androidVersion,
    android_release: client.session.profile.androidRelease,
  };
}

/** The account, device and crop fields that every photo-shaped configure call carries. */
function configureFraming(
  client: PrivateClient,
  width: number,
  height: number,
): Record<string, unknown> {
  return {
    ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
    device: deviceBlock(client),
    edits: { crop_original_size: [width, height], crop_center: [0, 0], crop_zoom: 1 },
    extra: { source_width: width, source_height: height },
  };
}

async function configurePhoto(
  client: PrivateClient,
  uploadId: string,
  caption: string,
  width: number,
  height: number,
): Promise<Media> {
  const json = await client.request({
    method: endpoints.mediaConfigure.method,
    endpoint: endpoints.mediaConfigure.path,
    payload: {
      upload_id: uploadId,
      caption,
      source_type: '4',
      ...configureFraming(client, width, height),
    },
  });
  return parseConfiguredMedia(json);
}

/**
 * Whether a configure error means the server is still transcoding the video. Throttling
 * and block errors are excluded even if their text mentions trying again: repeating
 * configure while throttled risks a harder block, and could publish the post twice if an
 * earlier attempt went through.
 */
function isTranscodePending(error: unknown): boolean {
  if (
    error instanceof PleaseWaitError ||
    error instanceof RateLimitError ||
    error instanceof FeedbackRequiredError ||
    error instanceof SentryBlockError
  ) {
    return false;
  }
  return error instanceof IgApiError && /transcode|not been uploaded/i.test(error.message);
}

async function configureVideo(
  client: PrivateClient,
  uploadId: string,
  caption: string,
  meta: { durationMs: number; width: number; height: number },
): Promise<Media> {
  const lengthSec = meta.durationMs / 1000;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const json = await client.request({
        method: endpoints.mediaConfigure.method,
        endpoint: endpoints.mediaConfigure.path,
        query: { video: '1' },
        payload: {
          upload_id: uploadId,
          caption,
          source_type: '4',
          length: lengthSec,
          clips: [{ length: lengthSec, source_type: '4' }],
          poster_frame_index: 0,
          audio_muted: false,
          filter_type: '0',
          ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
          device: deviceBlock(client),
          extra: { source_width: meta.width, source_height: meta.height },
        },
      });
      return parseConfiguredMedia(json);
    } catch (error) {
      if (attempt >= TRANSCODE_RETRIES || !isTranscodePending(error)) {
        throw error;
      }
      await sleep(TRANSCODE_DELAY_MS);
    }
  }
}

/**
 * Publishes a JPEG as a feed photo: uploads the bytes, then configures the post.
 * The dimensions are read from the JPEG, so the caller passes only bytes and an
 * optional caption.
 */
export async function uploadPhoto(
  client: PrivateClient,
  jpeg: Uint8Array,
  options: PhotoUploadOptions = {},
): Promise<Media> {
  const { width, height } = parseJpegSize(jpeg);
  const uploadId = await ruploadPhoto(client, jpeg, newUploadId(), '1');
  return configurePhoto(client, uploadId, options.caption ?? '', width, height);
}

/**
 * Publishes an MP4 as a feed video. The caller supplies a cover JPEG (frame
 * extraction needs a decoder, which the SDK does not bundle); duration and
 * dimensions are read from the MP4 unless given in `options`. Configure is
 * retried while the server is still transcoding.
 */
export async function uploadVideo(
  client: PrivateClient,
  mp4: Uint8Array,
  coverJpeg: Uint8Array,
  options: VideoUploadOptions = {},
): Promise<Media> {
  // Each value the caller gives wins over the one read from the file, and the file is
  // only parsed when something is missing, so a clip whose metadata cannot be read
  // still works when the caller supplies all three.
  const complete =
    options.durationMs !== undefined && options.width !== undefined && options.height !== undefined;
  const read = complete ? undefined : parseMp4Meta(mp4);
  const parsed = {
    durationMs: options.durationMs ?? read?.durationMs ?? 0,
    width: options.width ?? read?.width ?? 0,
    height: options.height ?? read?.height ?? 0,
  };
  const uploadId = newUploadId();
  await ruploadVideo(client, mp4, uploadId, parsed);
  await ruploadPhoto(client, coverJpeg, uploadId, '2');
  return configureVideo(client, uploadId, options.caption ?? '', parsed);
}

/** Configures an uploaded photo as a story (source_type 3). */
async function configureStory(
  client: PrivateClient,
  uploadId: string,
  width: number,
  height: number,
): Promise<Media> {
  const nowSec = String(Math.floor(Date.now() / 1000));
  const json = await client.request({
    method: endpoints.mediaConfigureToStory.method,
    endpoint: endpoints.mediaConfigureToStory.path,
    payload: {
      upload_id: uploadId,
      source_type: '3',
      configure_mode: '1',
      caption: '',
      creation_surface: 'camera',
      camera_entry_point: '12',
      capture_type: 'normal',
      client_shared_at: nowSec,
      client_timestamp: nowSec,
      story_media_creation_date: nowSec,
      disable_comments: '0',
      ...configureFraming(client, width, height),
    },
  });
  return parseConfiguredMedia(json);
}

/** Publishes a JPEG as a story. Dimensions are read from the JPEG. */
export async function uploadStoryPhoto(client: PrivateClient, jpeg: Uint8Array): Promise<Media> {
  const { width, height } = parseJpegSize(jpeg);
  const uploadId = await ruploadPhoto(client, jpeg, newUploadId(), '1');
  return configureStory(client, uploadId, width, height);
}

/** One picture of an album: a photo, or a video with its cover. */
export type AlbumItem =
  | { readonly photo: Uint8Array }
  | {
      readonly video: Uint8Array;
      readonly cover: Uint8Array;
      /** Overrides what is read from the MP4. */
      readonly durationMs?: number;
      readonly width?: number;
      readonly height?: number;
    };

export interface AlbumUploadOptions {
  readonly caption?: string;
}

/** Instagram takes 2 to 10 pictures in one carousel post. */
const ALBUM_MIN = 2;
const ALBUM_MAX = 10;

/** The time a picture was taken, in the `YYYYMMDDTHHMMSS.000Z` form the app sends. */
function takenAt(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    'T' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds()) +
    '.000Z'
  );
}

/** Uploads one album item and returns the metadata its place in the post needs. */
async function uploadAlbumChild(
  client: PrivateClient,
  item: AlbumItem,
  uploadId: string,
): Promise<Record<string, unknown>> {
  if ('photo' in item) {
    const { width, height } = parseJpegSize(item.photo);
    const serverId = await ruploadPhoto(client, item.photo, uploadId, '1', true);
    return {
      upload_id: serverId,
      edits: JSON.stringify({
        crop_original_size: [width, height],
        crop_center: [0, 0],
        crop_zoom: 1,
      }),
      extra: JSON.stringify({ source_width: width, source_height: height }),
      scene_capture_type: '',
      scene_type: null,
    };
  }
  const complete =
    item.durationMs !== undefined && item.width !== undefined && item.height !== undefined;
  const read = complete ? undefined : parseMp4Meta(item.video);
  const meta = {
    durationMs: item.durationMs ?? read?.durationMs ?? 0,
    width: item.width ?? read?.width ?? 0,
    height: item.height ?? read?.height ?? 0,
  };
  const serverId = await ruploadVideo(client, item.video, uploadId, meta, true);
  await ruploadPhoto(client, item.cover, serverId, '2');
  const seconds = meta.durationMs / 1000;
  return {
    upload_id: serverId,
    clips: JSON.stringify([{ length: seconds, source_type: '4' }]),
    extra: JSON.stringify({ source_width: meta.width, source_height: meta.height }),
    length: seconds,
    poster_frame_index: '0',
    filter_type: '0',
    video_result: '',
    date_time_original: takenAt(new Date()),
    audio_muted: 'false',
  };
}

/**
 * Publishes 2 to 10 photos and videos as one carousel post. Every item is uploaded
 * first, then one configure call publishes them together; that call is retried while
 * a video is still being transcoded.
 */
export async function uploadAlbum(
  client: PrivateClient,
  items: readonly AlbumItem[],
  options: AlbumUploadOptions = {},
): Promise<Media> {
  if (items.length < ALBUM_MIN || items.length > ALBUM_MAX) {
    throw new IgError(
      `An album takes ${String(ALBUM_MIN)} to ${String(ALBUM_MAX)} items, not ${String(items.length)}`,
    );
  }
  // Read every file first so a bad one fails before anything is uploaded.
  for (const item of items) {
    if ('photo' in item) {
      parseJpegSize(item.photo);
    } else {
      parseJpegSize(item.cover);
    }
  }

  const base = Date.now();
  const children: Record<string, unknown>[] = [];
  for (const [index, item] of items.entries()) {
    // One id per picture; the timestamp alone would repeat within a millisecond.
    children.push(await uploadAlbumChild(client, item, String(base + index)));
  }

  const albumId = String(Date.now());
  const device = deviceBlock(client);
  const payload = {
    timezone_offset: '0',
    source_type: '4',
    creation_logger_session_id: randomUUID(),
    location: '{}',
    caption: options.caption ?? '',
    client_sidecar_id: albumId,
    upload_id: albumId,
    suggested_venue_position: -1,
    device,
    is_suggested_venue: false,
    children_metadata: children.map((child) => ({
      source_type: '4',
      timezone_offset: '0',
      device: JSON.stringify(device),
      ...child,
    })),
    ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
  };

  for (let attempt = 0; ; attempt += 1) {
    try {
      const json = await client.request({
        method: endpoints.mediaConfigureSidecar.method,
        endpoint: endpoints.mediaConfigureSidecar.path,
        payload,
      });
      return parseConfiguredMedia(json);
    } catch (error) {
      if (attempt >= TRANSCODE_RETRIES || !isTranscodePending(error)) {
        throw error;
      }
      await sleep(TRANSCODE_DELAY_MS);
    }
  }
}
