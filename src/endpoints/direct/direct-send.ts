import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';
import { parseJpegSize } from '../../core/media/jpeg';
import { directSendResultSchema, type DirectSendResult } from '../../schemas/direct';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { findThreadByParticipants } from './direct-manage';
import type { SendTarget } from './direct';
import { mutationToken, numericIdArray } from './direct-wire';
import { checkedIds } from '../../core/ids';

const NAV_CHAIN =
  '1qT:feed_timeline:1,1qT:feed_timeline:2,1qT:feed_timeline:3,' +
  '7Az:direct_inbox:4,7Az:direct_inbox:5,5rG:direct_thread:7';
const MESSENGER_UPLOAD_HOST = 'https://rupload.facebook.com';

/** Where the recipients go in the body: thread ids, or a nested list of user ids. */
function recipientFields(target: SendTarget): Record<string, string> {
  if ('threadId' in target) {
    checkedIds([target.threadId], 'A thread id');
    return { thread_ids: numericIdArray([target.threadId]) };
  }
  checkedIds(target.userIds, 'User ids');
  return { recipient_users: `[${numericIdArray(target.userIds)}]` };
}

/** The fields every direct broadcast carries, mirroring what the app sends. */
function broadcastFields(client: PrivateClient, token: string): Record<string, string> {
  const { device } = client.session;
  return {
    action: 'send_item',
    is_shh_mode: '0',
    client_context: token,
    device_id: device.androidDeviceId,
    mutation_token: token,
    _uuid: device.uuid,
    btt_dual_send: 'false',
    nav_chain: NAV_CHAIN,
    is_ae_dual_send: 'false',
    offline_threading_id: token,
    ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
  };
}

export async function broadcast(
  client: PrivateClient,
  definition: EndpointDefinition,
  fields: Record<string, string>,
  query?: Record<string, string>,
): Promise<Record<string, unknown>> {
  return client.request({
    method: definition.method,
    endpoint: definition.path,
    payload: fields,
    encoding: 'form',
    withDefaultData: false,
    ...(query !== undefined ? { query } : {}),
  });
}

/** Validates the `payload` of a broadcast response into the send result. */
export function parseSendResult(json: Record<string, unknown>): DirectSendResult {
  const parsed = directSendResultSchema.safeParse(json['payload']);
  if (!parsed.success) {
    throw new ClientSchemaError('direct send response did not match the schema', json['payload'], {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** Sends a message whose text contains a link, so it renders as a link preview. */
export async function sendLink(
  client: PrivateClient,
  text: string,
  target: SendTarget,
): Promise<DirectSendResult> {
  const urls = text.match(/https?:\/\/\S+/g);
  if (urls === null) {
    throw new IgError('The text has no http(s) link to send');
  }
  const token = mutationToken();
  const json = await broadcast(client, endpoints.directBroadcastLink, {
    ...broadcastFields(client, token),
    send_attribution: 'message_button',
    link_text: text,
    link_urls: JSON.stringify(urls),
    ...recipientFields(target),
  });
  return parseSendResult(json);
}

/** Options for a reaction. */
export interface ReactionOptions {
  /** The emoji to react with. Defaults to a heart. */
  readonly emoji?: string;
  /** Remove the reaction instead of adding it. */
  readonly remove?: boolean;
}

/** Adds, or removes, an emoji reaction on a message of a thread. */
export async function reactToMessage(
  client: PrivateClient,
  threadId: string,
  itemId: string,
  options: ReactionOptions = {},
): Promise<void> {
  checkedIds([threadId, itemId], 'Thread and message ids');
  const token = mutationToken();
  await broadcast(client, endpoints.directBroadcastReaction, {
    ...broadcastFields(client, token),
    is_x_transport_forward: 'false',
    send_silently: 'false',
    send_attribution: 'message_reaction',
    // Quoted on purpose: a thread id has 39 digits, past 2^53, so a bare number would lose
    // precision in JavaScript. The server accepted this form on a 39-digit id (checked live).
    thread_ids: JSON.stringify([threadId]),
    item_type: 'reaction',
    reaction_type: 'like',
    reaction_status: options.remove === true ? 'deleted' : 'created',
    node_type: 'item',
    item_id: itemId,
    emoji: options.emoji ?? '❤',
    reaction_action_source: 'double_tap',
  });
}

/** Options for sharing a post. */
export interface ShareMediaOptions {
  /** What the shared media is. Defaults to a photo. */
  readonly mediaType?: 'photo' | 'video';
}

/** Shares a post (by its full media id) into a thread or to users. */
export async function shareMedia(
  client: PrivateClient,
  mediaId: string,
  target: SendTarget,
  options: ShareMediaOptions = {},
): Promise<DirectSendResult> {
  if (!/^\d+(_\d+)?$/.test(mediaId)) {
    throw new IgError('A media id looks like 123456_789');
  }
  const token = mutationToken();
  const json = await broadcast(
    client,
    endpoints.directBroadcastMediaShare,
    {
      ...broadcastFields(client, token),
      send_attribution: 'feed_timeline',
      media_id: mediaId,
      inventory_source: 'media_or_ad',
      ...recipientFields(target),
    },
    { media_type: options.mediaType ?? 'photo' },
  );
  return parseSendResult(json);
}

/** Shares a profile (by user id) into a thread or to users. */
export async function shareProfile(
  client: PrivateClient,
  userId: string,
  target: SendTarget,
): Promise<DirectSendResult> {
  checkedIds([userId], 'A user id');
  const token = mutationToken();
  const json = await broadcast(client, endpoints.directBroadcastProfile, {
    ...broadcastFields(client, token),
    send_attribution: 'profile',
    profile_user_id: userId,
    ...recipientFields(target),
  });
  return parseSendResult(json);
}

/**
 * The thread an attachment goes to. Photos, videos and voice messages need an existing
 * thread, so for a list of users the thread with exactly those participants is looked up.
 */
export async function existingThreadId(
  client: PrivateClient,
  target: SendTarget,
  what: string,
): Promise<string> {
  if ('threadId' in target) {
    checkedIds([target.threadId], 'A thread id');
    return target.threadId;
  }
  const thread = await findThreadByParticipants(client, target.userIds);
  if (thread?.thread_id === undefined) {
    throw new IgError(`A direct ${what} needs an existing thread with those participants`);
  }
  return thread.thread_id;
}

/** Uploads JPEG bytes to the messenger image host and returns the attachment id. */
async function uploadMessengerImage(client: PrivateClient, jpeg: Uint8Array): Promise<string> {
  const entity = `fb_uploader_${String(Date.now())}`;
  const userId = client.session.auth.userId ?? '';
  const json = await client.request({
    method: 'POST',
    endpoint: 'messenger_image',
    rawUrl: `${MESSENGER_UPLOAD_HOST}/messenger_image/${entity}`,
    rawBody: jpeg,
    withDefaultData: false,
    withSignature: false,
    headers: {
      'Content-Type': 'application/octet-stream',
      Offset: '0',
      // Both lengths are required together: without Content-Length Node falls back to
      // chunked encoding and the upload host rejects the mix as an invalid header format.
      'Content-Length': String(jpeg.length),
      'X-Entity-Length': String(jpeg.length),
      'X-Entity-Name': entity,
      'X-Entity-Type': 'image/jpeg',
      image_type: 'FILE_ATTACHMENT',
      'X-FB-Friendly-Name': 'undefined:media-upload',
      ...(userId !== '' ? { 'IG-INTENDED-USER-ID': userId, 'IG-U-DS-USER-ID': userId } : {}),
    },
  });
  const id = json['media_id'];
  if (typeof id !== 'string' && typeof id !== 'number') {
    throw new ClientSchemaError('the messenger image upload returned no media_id', json);
  }
  return String(id);
}

/** Sends a JPEG photo into a thread (or the existing thread with the given users). */
export async function sendPhoto(
  client: PrivateClient,
  jpeg: Uint8Array,
  target: SendTarget,
): Promise<DirectSendResult> {
  parseJpegSize(jpeg); // fail early on a non-JPEG before any network call
  const threadId = await existingThreadId(client, target, 'photo');
  const attachmentId = await uploadMessengerImage(client, jpeg);
  const token = mutationToken();
  const json = await broadcast(client, endpoints.directBroadcastPhotoAttachment, {
    ...broadcastFields(client, token),
    is_x_transport_forward: 'false',
    send_attribution: 'inbox',
    attachment_fbid: attachmentId,
    allow_full_aspect_ratio: 'true',
    thread_ids: numericIdArray([threadId]),
  });
  return parseSendResult(json);
}

/**
 * Shares a story (by its full id, `pk_ownerPk`) into a thread or to users. Only stories
 * visible to the account can be shared.
 */
export async function shareStory(
  client: PrivateClient,
  storyId: string,
  target: SendTarget,
): Promise<DirectSendResult> {
  if (!/^\d+_\d+$/.test(storyId)) {
    throw new IgError('A story id looks like 123456_789');
  }
  const token = mutationToken();
  const json = await broadcast(client, endpoints.directBroadcastStoryShare, {
    action: 'send_item',
    is_shh_mode: '0',
    send_attribution: 'reel_feed_timeline',
    client_context: token,
    mutation_token: token,
    nav_chain:
      '1qT:feed_timeline:1,ReelViewerFragment:reel_feed_timeline:4,' +
      'DirectShareSheetFragment:direct_reshare_sheet:5',
    // The reel of a story is its owner's: opening the share from the conversation looks the
    // story up under this id, and with the story's own id it answers "not available".
    reel_id: storyId.split('_')[1] ?? '',
    containermodule: 'reel_feed_timeline',
    story_media_id: storyId,
    offline_threading_id: token,
    ...recipientFields(target),
  });
  return parseSendResult(json);
}
