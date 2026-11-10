import { randomUUID } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { mediaSchema, type Media } from '../../schemas/media';
import { commentSchema, type Comment } from '../../schemas/comment';
import { ClientSchemaError } from '../../errors/api-errors';

/**
 * Fetches one media by its full id (the `pk_userid` composite the feed returns).
 * `media/{id}/info/` wraps the media in a one-element `items` array; the single
 * item is validated into the `Media` model. A missing item or a shape mismatch
 * surfaces as a typed error.
 */
export async function getMediaInfo(client: PrivateClient, mediaId: string): Promise<Media> {
  const json = await client.request({
    method: endpoints.mediaInfo.method,
    endpoint: endpoints.mediaInfo.path.replace('{id}', mediaId),
  });
  const items = json['items'];
  if (!Array.isArray(items) || items.length === 0) {
    throw new ClientSchemaError('media info response did not include a media item', json);
  }
  const parsed = mediaSchema.safeParse(items[0]);
  if (!parsed.success) {
    throw new ClientSchemaError('media info response did not match the media schema', items[0], {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** The common fields a media action POST carries, over the signed default data. */
function mediaActionPayload(client: PrivateClient): Record<string, unknown> {
  return {
    ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
    radio_type: 'wifi-none',
    module_name: 'feed_timeline',
  };
}

/** Likes a media by its full id. Resolves on success; throws a typed error otherwise. */
export async function likeMedia(client: PrivateClient, mediaId: string): Promise<void> {
  await client.request({
    method: endpoints.mediaLike.method,
    endpoint: endpoints.mediaLike.path.replace('{id}', mediaId),
    payload: { ...mediaActionPayload(client), media_id: mediaId },
  });
}

/** Removes a like from a media by its full id. */
export async function unlikeMedia(client: PrivateClient, mediaId: string): Promise<void> {
  await client.request({
    method: endpoints.mediaUnlike.method,
    endpoint: endpoints.mediaUnlike.path.replace('{id}', mediaId),
    payload: { ...mediaActionPayload(client), media_id: mediaId },
  });
}

/** Posts a comment on a media and returns the created comment. */
export async function commentMedia(
  client: PrivateClient,
  mediaId: string,
  text: string,
): Promise<Comment> {
  const json = await client.request({
    method: endpoints.mediaComment.method,
    endpoint: endpoints.mediaComment.path.replace('{id}', mediaId),
    payload: {
      ...mediaActionPayload(client),
      comment_text: text,
      idempotence_token: randomUUID(),
    },
  });
  const comment = json['comment'];
  const parsed = commentSchema.safeParse(comment);
  if (!parsed.success) {
    throw new ClientSchemaError('comment response did not match the comment schema', comment, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** Deletes one of the logged-in account's own media by its id. */
export async function deleteMedia(
  client: PrivateClient,
  mediaId: string,
  mediaType: 'PHOTO' | 'VIDEO' | 'CAROUSEL' = 'PHOTO',
): Promise<void> {
  await client.request({
    method: endpoints.mediaDelete.method,
    endpoint: endpoints.mediaDelete.path.replace('{id}', mediaId),
    query: { media_type: mediaType },
    payload: {
      igtv_feed_preview: false,
      media_id: mediaId,
      ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
    },
  });
}

/** Deletes a comment from a media by the comment's id. */
export async function deleteComment(
  client: PrivateClient,
  mediaId: string,
  commentId: string,
): Promise<void> {
  await client.request({
    method: endpoints.mediaCommentDelete.method,
    endpoint: endpoints.mediaCommentDelete.path
      .replace('{id}', mediaId)
      .replace('{comment_id}', commentId),
    payload: mediaActionPayload(client),
  });
}
