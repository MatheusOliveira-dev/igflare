import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { parseMp4Meta } from '../../core/media/mp4';
import type { DirectSendResult } from '../../schemas/direct';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import type { SendTarget } from './direct';
import { broadcast, existingThreadId, parseSendResult } from './direct-send';
import { mutationToken, numericIdArray } from './direct-wire';

const MESSENGER_UPLOAD_HOST = 'https://rupload.facebook.com';
const WAVEFORM_BARS = 70;

/** The headers the upload host wants, on top of the per-kind ones. */
function uploadHeaders(client: PrivateClient): Record<string, string> {
  const userId = client.session.auth.userId ?? '';
  return {
    'X-FB-Friendly-Name': 'undefined:media-upload',
    ...(userId !== '' ? { 'IG-INTENDED-USER-ID': userId, 'IG-U-DS-USER-ID': userId } : {}),
  };
}

/** The resumable offset the upload host reports for an entity (0 for a new upload). */
function readOffset(json: Record<string, unknown>, size: number): number {
  const value = Number(json['offset'] ?? 0);
  return Number.isInteger(value) && value >= 0 && value <= size ? value : 0;
}

interface MessengerUpload {
  /** The path segment of the host: `messenger_video` or `messenger_audio`. */
  readonly kind: string;
  readonly entity: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** Headers that belong to this kind of attachment. */
  readonly headers: Record<string, string>;
}

/**
 * Uploads an attachment to the messenger host in the two steps the app uses: ask where
 * the upload stands (a resumable offset), then send the bytes from there. Returns the
 * attachment id the broadcast refers to.
 */
async function uploadMessengerAttachment(
  client: PrivateClient,
  upload: MessengerUpload,
): Promise<string> {
  const url = `${MESSENGER_UPLOAD_HOST}/${upload.kind}/${upload.entity}`;
  const common = { ...uploadHeaders(client), ...upload.headers };
  const status = await client.request({
    method: 'GET',
    endpoint: upload.kind,
    rawUrl: url,
    withDefaultData: false,
    withSignature: false,
    headers: common,
  });
  const offset = readOffset(status, upload.bytes.length);
  const rest = upload.bytes.subarray(offset);
  const json = await client.request({
    method: 'POST',
    endpoint: upload.kind,
    rawUrl: url,
    rawBody: rest,
    withDefaultData: false,
    withSignature: false,
    headers: {
      ...common,
      'Content-Type': 'application/octet-stream',
      Offset: String(offset),
      // Both lengths are needed together. Without Content-Length Node falls back to
      // chunked encoding, which the upload host rejects.
      'Content-Length': String(rest.length),
      'X-Entity-Length': String(upload.bytes.length),
      'X-Entity-Name': upload.entity,
      'X-Entity-Type': upload.contentType,
    },
  });
  const id = json['media_id'];
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new ClientSchemaError(`the ${upload.kind} upload returned no media_id`, json);
  }
  return String(id);
}

/**
 * Sends an MP4 video (H.264 video, AAC audio) into a thread, or into the existing thread
 * with the given users.
 */
export async function sendVideo(
  client: PrivateClient,
  mp4: Uint8Array,
  target: SendTarget,
): Promise<DirectSendResult> {
  const meta = parseMp4Meta(mp4); // fail early on a non-MP4, before any network call
  const threadId = await existingThreadId(client, target, 'video');

  const hex = randomBytes(16).toString('hex');
  const now = Date.now();
  const uploadId = String(randomInt(1e11, 1e12));
  const attachmentId = await uploadMessengerAttachment(client, {
    kind: 'messenger_video',
    entity: `${hex}-0-${String(mp4.length)}-${String(now)}-${String(now)}`,
    bytes: mp4,
    contentType: 'video/mp4',
    headers: {
      video_type: 'FILE_ATTACHMENT',
      'segment-start-offset': '0',
      'segment-type': '3',
      ephemeral_media_view_mode: '2',
      ig_raven_metadata: '{}',
      x_fb_video_waterfall_id: `${uploadId}_${hex.slice(0, 12).toUpperCase()}_Mixed_0`,
    },
  });

  const token = mutationToken();
  const seconds = meta.durationMs / 1000;
  const { device } = client.session;
  const sharedAt = String(Math.floor(Date.now() / 1000));
  const json = await client.request({
    method: endpoints.directBroadcastRavenAttachment.method,
    endpoint: endpoints.directBroadcastRavenAttachment.path,
    query: { video: '1' },
    withDefaultData: false,
    payload: {
      recipient_users: '[]',
      view_mode: 'permanent',
      has_camera_metadata: '1',
      camera_entry_point: '3',
      thread_ids: numericIdArray([threadId]),
      reshare_mode: 'allow_reshare',
      original_media_type: '2',
      send_attribution: 'direct_composer',
      client_context: token,
      attachment_fbid: attachmentId,
      include_e2ee_mentioned_user_list: '1',
      hide_from_profile_grid: 'false',
      timezone_offset: '0',
      client_shared_at: sharedAt,
      configure_mode: '2',
      source_type: '3',
      camera_position: 'back',
      video_result: attachmentId,
      device_id: device.androidDeviceId,
      composition_id: randomUUID(),
      mutation_token: token,
      _uuid: device.uuid,
      creation_surface: 'camera',
      has_ig_camera_edits: 'false',
      capture_type: 'normal',
      audience: 'default',
      upload_id: uploadId,
      client_timestamp: sharedAt,
      media_transformation_info: JSON.stringify({
        width: String(meta.width),
        height: String(meta.height),
        x_transform: '0',
        y_transform: '0',
        zoom: '1.0',
        rotation: '0.0',
        background_coverage: '0.0',
      }),
      clips: [{ length: seconds, source_type: '3', camera_position: 'back' }],
      poster_frame_index: 0,
      length: seconds,
      audio_muted: false,
      edits: { filter_type: 0, filter_strength: 1 },
      extra: { source_width: meta.width, source_height: meta.height },
      ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
    },
  });
  return parseSendResult(json);
}

export interface VoiceOptions {
  /**
   * The 70 loudness values (0 to 1) the voice bubble draws as bars. Purely cosmetic. The
   * server does not check them. Defaults to a varied pattern so the bubble is not flat.
   */
  readonly waveform?: readonly number[];
}

/** An AAC clip in an MP4 container starts with an `ftyp` box. */
function assertAudioContainer(bytes: Uint8Array): void {
  const tag = String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0);
  if (tag !== 'ftyp') {
    throw new IgError('A voice message must be an AAC clip in an MP4 container (.m4a)');
  }
}

function defaultWaveform(): number[] {
  return Array.from({ length: WAVEFORM_BARS }, () => randomInt(200, 951) / 1000);
}

/** Sends a voice message (an `.m4a` AAC clip) into a thread or the thread with the users. */
export async function sendVoice(
  client: PrivateClient,
  m4a: Uint8Array,
  target: SendTarget,
  options: VoiceOptions = {},
): Promise<DirectSendResult> {
  assertAudioContainer(m4a);
  const waveform = options.waveform ?? defaultWaveform();
  if (
    waveform.length !== WAVEFORM_BARS ||
    waveform.some((bar) => !Number.isFinite(bar) || bar < 0 || bar > 1)
  ) {
    throw new IgError(`The waveform is ${String(WAVEFORM_BARS)} values between 0 and 1`);
  }
  const threadId = await existingThreadId(client, target, 'voice message');

  const uploadId = String(Date.now());
  const key = randomInt(-(2 ** 31), 2 ** 31);
  const attachmentId = await uploadMessengerAttachment(client, {
    kind: 'messenger_audio',
    entity: `${uploadId}_0_${String(key)}`,
    bytes: m4a,
    contentType: 'audio/mp4',
    headers: { audio_type: 'FILE_ATTACHMENT' },
  });

  const token = mutationToken();
  const { device } = client.session;
  const json = await broadcast(client, endpoints.directBroadcastVoiceAttachment, {
    action: 'send_item',
    thread_ids: numericIdArray([threadId]),
    send_attribution: 'inbox',
    client_context: token,
    attachment_fbid: attachmentId,
    device_id: device.androidDeviceId,
    mutation_token: token,
    _uuid: device.uuid,
    waveform: JSON.stringify(waveform),
    waveform_sampling_frequency_hz: '10',
    upload_id: uploadId,
    offline_threading_id: token,
    ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
  });
  return parseSendResult(json);
}
