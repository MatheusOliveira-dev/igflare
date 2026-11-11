import { randomUUID, randomInt } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';
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

/**
 * Sends a configure call and returns the published media, trying again while the server
 * is still transcoding a video. Every post kind that carries a video ends this way.
 */
async function configureMedia(
  client: PrivateClient,
  definition: EndpointDefinition,
  payload: Record<string, unknown>,
  query?: Record<string, string>,
): Promise<Media> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const json = await client.request({
        method: definition.method,
        endpoint: definition.path,
        payload,
        ...(query !== undefined ? { query } : {}),
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

async function configureVideo(
  client: PrivateClient,
  uploadId: string,
  caption: string,
  meta: { durationMs: number; width: number; height: number },
): Promise<Media> {
  const lengthSec = meta.durationMs / 1000;
  return configureMedia(
    client,
    endpoints.mediaConfigure,
    {
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
    { video: '1' },
  );
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
 * extraction needs a decoder, which the SDK does not bundle). Duration and
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

/**
 * Uploads a JPEG that is not published on its own (a highlight cover, a profile picture)
 * and returns the upload id the next call refers to.
 */
export function uploadStandalonePhoto(client: PrivateClient, jpeg: Uint8Array): Promise<string> {
  parseJpegSize(jpeg); // fail early on a non-JPEG, before any network call
  return ruploadPhoto(client, jpeg, newUploadId(), '1');
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
 * first, then one configure call publishes them together. That call is retried while
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
    // One id per picture. The timestamp alone would repeat within a millisecond.
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

  return configureMedia(client, endpoints.mediaConfigureSidecar, payload);
}

export interface ReelUploadOptions {
  readonly caption?: string;
  /** Whether the reel also shows as a preview in the profile grid and feed. Defaults to true. */
  readonly showInFeed?: boolean;
  /** Overrides the value read from the MP4 when parsing fails or is undesired. */
  readonly durationMs?: number;
  readonly width?: number;
  readonly height?: number;
}

interface ReelUpload {
  readonly uploadId: string;
  readonly composerSessionId: string;
  readonly assetId: string;
  readonly meta: { durationMs: number; width: number; height: number };
}

/** The settings the app posts before it sends a reel: what the video is and how to treat it. */
async function sendReelUploadSettings(
  client: PrivateClient,
  upload: ReelUpload,
  byteLength: number,
): Promise<void> {
  const { meta } = upload;
  const owner = Number(client.session.auth.userId);
  const settings = JSON.stringify({
    composer_session_id: upload.composerSessionId,
    upload_setting_properties: {
      upload_settings_version: 'v0.1',
      codec: {},
      context: {
        source_attribution: null,
        enable_video_dimension_upscale: false,
        source_type: 'clips',
        quality: '',
        ...(Number.isSafeInteger(owner) ? { target_id: owner } : {}),
      },
      video: {
        video_height: meta.height,
        video_gop_size_sec: 0,
        video_rotation_angle: 0,
        video_width: meta.width,
        source_video_codec: null,
        video_partial_frame_size_bytes: 0,
        asset_id: upload.assetId,
        video_key_frame_size_bytes: 0,
        target_duration: Math.trunc(meta.durationMs / 1000),
        video_original_file_size: byteLength,
        video_duration_milliseconds: Math.trunc(meta.durationMs),
        audio_bit_rate_bps: -1,
        video_bit_rate_bps: 0,
        audio_codec_type: null,
        video_fps: 30,
      },
      creative_tools: { transmuxing_eligible: false, transcoding_required: true },
      network: {
        download_latency_connection_quality: 'ig_dummy',
        network_connection_name: 'ig_dummy',
        download_bandwidth_connection_quality: 'ig_dummy',
      },
    },
    preview_spec: {
      spec_version: 1,
      video_dur_ms: Math.trunc(meta.durationMs),
      audio_dur_ms: Math.trunc(meta.durationMs),
    },
  });
  const body = new TextEncoder().encode(settings);
  await client.request({
    method: 'POST',
    endpoint: 'upload_settings',
    rawUrl: `${RUPLOAD_HOST}/upload_settings/${upload.composerSessionId}`,
    rawBody: body,
    withSignature: false,
    withDefaultData: false,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(body.length),
      Offset: '0',
      'X-Entity-Length': String(body.length),
      'X-Entity-Name': 'upload_settings',
      'X-Entity-Type': 'application/json',
      X_FB_VIDEO_WATERFALL_ID: `${upload.composerSessionId}_settings`,
    },
  });
}

/** Sends the video the way the app sends a reel: ask for the offset, then upload from it. */
async function ruploadReelVideo(
  client: PrivateClient,
  mp4: Uint8Array,
  upload: ReelUpload,
): Promise<void> {
  const { meta } = upload;
  const stamp = String(Date.now());
  const name = `${randomUUID().replaceAll('-', '')}-0-${String(mp4.length)}-${stamp}-${stamp}`;
  const url = `${RUPLOAD_HOST}/rupload_igvideo/${name}`;
  const headers = {
    'X-Instagram-Rupload-Params': JSON.stringify({
      provenance_metadata: JSON.stringify({ origin: ['EXTERNAL'] }),
      upload_media_height: String(meta.height),
      share_type: 'reels',
      debug_segment_id: '0',
      extract_cover_frame: '1',
      upload_engine_config_enum: '0',
      xsharing_user_ids: '[]',
      upload_media_width: String(meta.width),
      stella_data: '{}',
      is_clips_video: '1',
      is_optimistic_upload: 'true',
      upload_media_duration_ms: String(Math.trunc(meta.durationMs)),
      content_tags: 'use_default_cover',
      upload_id: upload.uploadId,
      retry_context: RETRY_CONTEXT,
      session_id: upload.uploadId,
      media_type: '2',
    }),
    X_FB_VIDEO_WATERFALL_ID: `${upload.composerSessionId}_${upload.assetId}_Mixed_0`,
    'X-Entity-Type': 'video/mp4',
    'Segment-Start-Offset': '0',
    'Segment-Type': '3',
  };
  await client.request({
    method: 'GET',
    endpoint: 'rupload_igvideo',
    rawUrl: url,
    withSignature: false,
    withDefaultData: false,
    headers,
  });
  await client.request({
    method: 'POST',
    endpoint: 'rupload_igvideo',
    rawUrl: url,
    rawBody: mp4,
    withSignature: false,
    withDefaultData: false,
    headers: {
      ...headers,
      Offset: '0',
      'X-Entity-Name': name,
      'X-Entity-Length': String(mp4.length),
      'Content-Length': String(mp4.length),
      'Content-Type': 'application/octet-stream',
    },
  });
}

/**
 * Publishes an MP4 as a reel. The caller supplies the cover JPEG (frame extraction needs
 * a decoder, which the SDK does not bundle). Duration and size are read from the MP4
 * unless given. The steps are the app's: the upload settings, the video, the cover, then
 * the configure call, retried while the server is still transcoding.
 */
export async function uploadReel(
  client: PrivateClient,
  mp4: Uint8Array,
  coverJpeg: Uint8Array,
  options: ReelUploadOptions = {},
): Promise<Media> {
  parseJpegSize(coverJpeg); // fail early on a bad cover, before anything is uploaded
  const complete =
    options.durationMs !== undefined && options.width !== undefined && options.height !== undefined;
  const read = complete ? undefined : parseMp4Meta(mp4);
  const meta = {
    durationMs: options.durationMs ?? read?.durationMs ?? 0,
    width: options.width ?? read?.width ?? 0,
    height: options.height ?? read?.height ?? 0,
  };
  const upload: ReelUpload = {
    uploadId: String(Date.now()),
    composerSessionId: randomUUID(),
    assetId: randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(),
    meta,
  };

  await sendReelUploadSettings(client, upload, mp4.length);
  await ruploadReelVideo(client, mp4, upload);
  await ruploadPhoto(client, coverJpeg, upload.uploadId, '2');

  const seconds = meta.durationMs / 1000;
  const payload = {
    filter_type: '0',
    timezone_offset: '0',
    location: '{}',
    source_type: '4',
    caption: options.caption ?? '',
    usertags: JSON.stringify({ in: [] }),
    clips_share_preview_to_feed: options.showInFeed === false ? '0' : '1',
    upload_id: upload.uploadId,
    device: deviceBlock(client),
    length: seconds,
    clips_segments_metadata: {
      num_segments: 1,
      clips_segments: [
        {
          index: 0,
          face_effect_id: null,
          speed: 100,
          source_type: 4,
          duration_ms: Math.trunc(meta.durationMs),
          audio_type: 'original',
          from_draft: 0,
          camera_position: -1,
          media_folder: null,
          media_type: 'video',
          original_media_type: 2,
          original_segment_hash: null,
          is_remix: false,
          has_reusable_template_asset: false,
        },
      ],
    },
    clips_audio_metadata: { original: { volume_level: 1 } },
    additional_audio_info: { has_voiceover_attribution: 0 },
    edits: { filter_type: 0, filter_strength: 1 },
    capture_type: 'clips_v2',
    clips_creation_entry_point: 'clips',
    camera_entry_point: '71',
    audience: 'default',
    include_e2ee_mentioned_user_list: '1',
    hide_from_profile_grid: 'false',
    original_width: meta.width,
    original_height: meta.height,
    extra: { source_width: meta.width, source_height: meta.height },
    audio_muted: false,
    poster_frame_index: 70,
    ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
  };

  return configureMedia(client, endpoints.mediaConfigureToClips, payload, { video: '1' });
}
