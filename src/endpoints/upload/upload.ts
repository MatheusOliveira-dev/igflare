import { randomUUID, randomInt } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { parseJpegSize } from '../../core/media/jpeg';
import { mediaSchema, type Media } from '../../schemas/media';
import { ClientSchemaError } from '../../errors/api-errors';

const RUPLOAD_HOST = 'https://i.instagram.com';

export interface PhotoUploadOptions {
  readonly caption?: string;
}

/** A fresh upload id (epoch ms) and the per-upload entity name the rupload uses. */
function newUpload(): { uploadId: string; name: string } {
  const uploadId = String(Date.now());
  const salt = randomInt(1_000_000_000);
  return { uploadId, name: `${uploadId}_0_${String(salt)}` };
}

/** Uploads raw JPEG bytes via rupload_igphoto and returns the server upload id. */
async function ruploadPhoto(client: PrivateClient, jpeg: Uint8Array): Promise<string> {
  const { uploadId, name } = newUpload();
  const ruploadParams = {
    retry_context: JSON.stringify({
      num_step_auto_retry: 0,
      num_reupload: 0,
      num_step_manual_retry: 0,
    }),
    media_type: '1',
    xsharing_user_ids: '[]',
    upload_id: uploadId,
    image_compression: JSON.stringify({ lib_name: 'moz', lib_version: '3.1.m', quality: '80' }),
  };
  const json = await client.request({
    method: 'POST',
    endpoint: 'rupload_igphoto',
    rawUrl: `${RUPLOAD_HOST}/rupload_igphoto/${name}`,
    rawBody: jpeg,
    withSignature: false,
    withDefaultData: false,
    headers: {
      'X-Instagram-Rupload-Params': JSON.stringify(ruploadParams),
      'X-Entity-Type': 'image/jpeg',
      'X-Entity-Name': name,
      'X-Entity-Length': String(jpeg.length),
      'Content-Length': String(jpeg.length),
      'Content-Type': 'application/octet-stream',
      Offset: '0',
      'X-FB-Photo-Waterfall-ID': randomUUID(),
    },
  });
  return typeof json['upload_id'] === 'string' ? json['upload_id'] : uploadId;
}

/** Validates a configure response's `media` node into the typed model. */
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

/** Configures an uploaded photo into a feed post and returns the created media. */
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
      device: {
        manufacturer: client.session.profile.manufacturer,
        model: client.session.profile.model,
        android_version: client.session.profile.androidVersion,
        android_release: client.session.profile.androidRelease,
      },
      edits: {
        crop_original_size: [width, height],
        crop_center: [0, 0],
        crop_zoom: 1,
      },
      extra: { source_width: width, source_height: height },
    },
  });
  return parseConfiguredMedia(json);
}

/**
 * Publishes a JPEG as a feed photo: uploads the bytes, then configures the post.
 * The dimensions are read from the JPEG, so the caller passes only the bytes and
 * an optional caption.
 */
export async function uploadPhoto(
  client: PrivateClient,
  jpeg: Uint8Array,
  options: PhotoUploadOptions = {},
): Promise<Media> {
  const { width, height } = parseJpegSize(jpeg);
  const uploadId = await ruploadPhoto(client, jpeg);
  return configurePhoto(client, uploadId, options.caption ?? '', width, height);
}
