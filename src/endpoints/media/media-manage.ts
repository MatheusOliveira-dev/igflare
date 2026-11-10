import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';
import { mediaSchema, type Media } from '../../schemas/media';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { isRecord } from '../direct/direct-wire';
import { mediaActionPayload } from './media';

function mediaPathId(mediaId: string): string {
  if (!/^\d+(_\d+)?$/.test(mediaId)) {
    throw new IgError('A media id looks like 123456 or 123456_789');
  }
  return mediaId;
}

/** The numeric pk of a media id, whether it is `pk` or `pk_userid`. */
function mediaPk(mediaId: string): string {
  return mediaPathId(mediaId).split('_')[0] ?? mediaId;
}

export interface EditMediaOptions {
  /** The new caption. */
  readonly caption: string;
}

/** Edits the caption of one of the account's posts and returns the updated media. */
export async function editMedia(
  client: PrivateClient,
  mediaId: string,
  options: EditMediaOptions,
): Promise<Media> {
  const json = await client.request({
    method: endpoints.mediaEdit.method,
    endpoint: endpoints.mediaEdit.path.replace('{id}', mediaPathId(mediaId)),
    payload: {
      caption_text: options.caption,
      container_module: 'edit_media_info',
      feed_position: '0',
      is_carousel_bumped_post: 'false',
    },
  });
  const media = json['media'];
  const parsed = mediaSchema.safeParse(isRecord(media) ? media : undefined);
  if (!parsed.success) {
    throw new ClientSchemaError('edit_media response did not include the media', json, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function mediaAction(
  client: PrivateClient,
  definition: EndpointDefinition,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.request({ method: definition.method, endpoint, payload });
}

/** Archives a post: it leaves the profile and moves to the archive. */
export async function archiveMedia(client: PrivateClient, mediaId: string): Promise<void> {
  await mediaAction(
    client,
    endpoints.mediaArchive,
    endpoints.mediaArchive.path.replace('{id}', mediaPathId(mediaId)),
    { ...mediaActionPayload(client), media_id: mediaId },
  );
}

/** Brings an archived post back to the profile. */
export async function unarchiveMedia(client: PrivateClient, mediaId: string): Promise<void> {
  await mediaAction(
    client,
    endpoints.mediaUnarchive,
    endpoints.mediaUnarchive.path.replace('{id}', mediaPathId(mediaId)),
    { ...mediaActionPayload(client), media_id: mediaId },
  );
}

/** Pins a post to the top of the profile grid. */
export async function pinMedia(client: PrivateClient, mediaId: string): Promise<void> {
  await mediaAction(client, endpoints.usersPinTimelineMedia, endpoints.usersPinTimelineMedia.path, {
    ...mediaActionPayload(client),
    post_id: mediaPk(mediaId),
  });
}

/** Unpins a post from the top of the profile grid. */
export async function unpinMedia(client: PrivateClient, mediaId: string): Promise<void> {
  await mediaAction(
    client,
    endpoints.usersUnpinTimelineMedia,
    endpoints.usersUnpinTimelineMedia.path,
    { ...mediaActionPayload(client), post_id: mediaPk(mediaId) },
  );
}
