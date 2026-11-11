import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { mediaSchema, type Media } from '../../schemas/media';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { checkedMediaId } from '../../core/ids';
import { assertIds } from '../direct/direct-wire';
import { isRecord } from '../../core/guards';
import { mediaAction, mediaActionPayload } from './media';

/** The numeric pk of a media id, whether it is `pk` or `pk_userid`. */
function mediaPk(mediaId: string): string {
  return checkedMediaId(mediaId).split('_')[0] ?? mediaId;
}

/** Where on the photo a person is tagged, as fractions of its width and height. */
export interface UserTag {
  readonly userId: string;
  readonly x: number;
  readonly y: number;
}

export interface EditMediaOptions {
  /** The new caption. */
  readonly caption: string;
  /**
   * People to tag, or to move if they are already tagged. Tags not listed are
   * left alone. On a private account the server only applies a tag for someone who can
   * see the post (a follower); for anyone else it answers ok and tags nobody, so read
   * the result back from `usertags`.
   */
  readonly tag?: readonly UserTag[];
  /** Ids of people to remove from the post's tags. An empty list of `tag` does not remove. */
  readonly untag?: readonly string[];
}

/**
 * The usertags JSON the edit endpoint takes: `in` adds or moves tags and `removed`
 * lists the user ids to untag. Built by hand because user ids can exceed what a JS
 * number holds exactly, so they must not round-trip through one.
 */
function usertagsJson(tag: readonly UserTag[], untag: readonly string[] | undefined): string {
  const entries = tag.map((entry) => {
    assertIds([entry.userId], 'A tagged user id');
    if (!(entry.x >= 0 && entry.x <= 1 && entry.y >= 0 && entry.y <= 1)) {
      throw new IgError('A tag position is a pair of fractions between 0 and 1');
    }
    return `{"user_id":${entry.userId},"position":[${String(entry.x)},${String(entry.y)}]}`;
  });
  let json = `"in":[${entries.join(',')}]`;
  if (untag !== undefined && untag.length > 0) {
    assertIds(untag, 'Untagged user ids');
    json += `,"removed":[${untag.join(',')}]`;
  }
  return `{${json}}`;
}

/**
 * Edits the caption of one of the account's posts, and optionally tags or untags people.
 * Returns the updated media. Tags are only sent when asked for, so a caption edit never
 * changes them.
 */
export async function editMedia(
  client: PrivateClient,
  mediaId: string,
  options: EditMediaOptions,
): Promise<Media> {
  const json = await client.request({
    method: endpoints.mediaEdit.method,
    endpoint: endpoints.mediaEdit.path.replace('{id}', checkedMediaId(mediaId)),
    payload: {
      caption_text: options.caption,
      container_module: 'edit_media_info',
      feed_position: '0',
      is_carousel_bumped_post: 'false',
      ...(options.tag !== undefined || options.untag !== undefined
        ? { usertags: usertagsJson(options.tag ?? [], options.untag) }
        : {}),
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

/** Archives a post: it leaves the profile and moves to the archive. */
export async function archiveMedia(client: PrivateClient, mediaId: string): Promise<void> {
  await mediaAction(
    client,
    endpoints.mediaArchive,
    endpoints.mediaArchive.path.replace('{id}', checkedMediaId(mediaId)),
    { ...mediaActionPayload(client), media_id: mediaId },
  );
}

/** Brings an archived post back to the profile. */
export async function unarchiveMedia(client: PrivateClient, mediaId: string): Promise<void> {
  await mediaAction(
    client,
    endpoints.mediaUnarchive,
    endpoints.mediaUnarchive.path.replace('{id}', checkedMediaId(mediaId)),
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
