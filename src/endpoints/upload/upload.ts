import { randomUUID, randomInt } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { parseJpegSize } from '../../core/media/jpeg';
import { parseMp4Meta } from '../../core/media/mp4';
import { mediaSchema, type Media } from '../../schemas/media';
import { ClientSchemaError, IgApiError } from '../../errors/api-errors';

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
): Promise<string> {
  return rupload(client, 'igphoto', uploadId, jpeg, 'image/jpeg', {
    retry_context: RETRY_CONTEXT,
    media_type: mediaType,
    xsharing_user_ids: '[]',
    upload_id: uploadId,
    image_compression: JSON.stringify({ lib_name: 'moz', lib_version: '3.1.m', quality: '80' }),
  });
}

function ruploadVideo(
  client: PrivateClient,
  mp4: Uint8Array,
  uploadId: string,
  meta: { durationMs: number; width: number; height: number },
): Promise<string> {
  return rupload(client, 'igvideo', uploadId, mp4, 'video/mp4', {
    retry_context: RETRY_CONTEXT,
    media_type: '2',
    xsharing_user_ids: '[]',
    upload_id: uploadId,
    upload_media_duration_ms: String(meta.durationMs),
    upload_media_width: String(meta.width),
    upload_media_height: String(meta.height),
  });
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
      ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
      device: deviceBlock(client),
      edits: { crop_original_size: [width, height], crop_center: [0, 0], crop_zoom: 1 },
      extra: { source_width: width, source_height: height },
    },
  });
  return parseConfiguredMedia(json);
}

/** Whether a configure error means the server is still transcoding the video. */
function isTranscodePending(error: unknown): boolean {
  return (
    error instanceof IgApiError && /transcode|not been uploaded|try again/i.test(error.message)
  );
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
  const parsed =
    options.durationMs !== undefined && options.width !== undefined && options.height !== undefined
      ? { durationMs: options.durationMs, width: options.width, height: options.height }
      : parseMp4Meta(mp4);
  const uploadId = newUploadId();
  await ruploadVideo(client, mp4, uploadId, parsed);
  await ruploadPhoto(client, coverJpeg, uploadId, '2');
  return configureVideo(client, uploadId, options.caption ?? '', parsed);
}
