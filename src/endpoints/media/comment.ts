import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';
import { commentSchema, type Comment } from '../../schemas/comment';
import { parseSchemaList } from '../../schemas/parse-list';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { assertIds } from '../direct/direct-wire';
import { mediaActionPayload } from './media';
import { IgError } from '../../errors/ig-error';

/** A media id is the numeric pk, optionally with the author id (`pk_userid`). */
function assertMediaId(mediaId: string): void {
  if (!/^\d+(_\d+)?$/.test(mediaId)) {
    throw new IgError('A media id looks like 123456 or 123456_789');
  }
}

function commentPath(
  definition: EndpointDefinition,
  values: { readonly mediaId?: string; readonly commentId: string },
): string {
  assertIds([values.commentId], 'A comment id');
  let path = definition.path.replace('{comment_id}', values.commentId);
  if (values.mediaId !== undefined) {
    assertMediaId(values.mediaId);
    path = path.replace('{id}', values.mediaId);
  }
  return path;
}

async function post(
  client: PrivateClient,
  definition: EndpointDefinition,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.request({ method: definition.method, endpoint, payload });
}

/** Likes a comment by its id. */
export async function likeComment(client: PrivateClient, commentId: string): Promise<void> {
  await post(
    client,
    endpoints.mediaCommentLike,
    commentPath(endpoints.mediaCommentLike, { commentId }),
    {
      ...mediaActionPayload(client),
      is_carousel_bumped_post: 'false',
      container_module: 'feed_contextual_self_profile',
      feed_position: '0',
    },
  );
}

/** Removes a like from a comment. */
export async function unlikeComment(client: PrivateClient, commentId: string): Promise<void> {
  await post(
    client,
    endpoints.mediaCommentUnlike,
    commentPath(endpoints.mediaCommentUnlike, { commentId }),
    {
      ...mediaActionPayload(client),
      is_carousel_bumped_post: 'false',
      container_module: 'feed_contextual_self_profile',
      feed_position: '0',
    },
  );
}

/** Pins a comment to the top of one of the account's own posts. */
export async function pinComment(
  client: PrivateClient,
  mediaId: string,
  commentId: string,
): Promise<void> {
  await post(
    client,
    endpoints.mediaCommentPin,
    commentPath(endpoints.mediaCommentPin, { mediaId, commentId }),
    mediaActionPayload(client),
  );
}

/** Unpins a pinned comment. */
export async function unpinComment(
  client: PrivateClient,
  mediaId: string,
  commentId: string,
): Promise<void> {
  await post(
    client,
    endpoints.mediaCommentUnpin,
    commentPath(endpoints.mediaCommentUnpin, { mediaId, commentId }),
    mediaActionPayload(client),
  );
}

/** Deletes several comments of a media in one request. */
export async function deleteComments(
  client: PrivateClient,
  mediaId: string,
  commentIds: readonly string[],
): Promise<void> {
  assertMediaId(mediaId);
  assertIds(commentIds, 'Comment ids');
  await post(
    client,
    endpoints.mediaCommentBulkDelete,
    endpoints.mediaCommentBulkDelete.path.replace('{id}', mediaId),
    {
      ...mediaActionPayload(client),
      comment_ids_to_delete: commentIds.join(','),
      container_module: 'self_comments_v2_newsfeed_you',
    },
  );
}

export interface ReplyListOptions {
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly cursor?: string;
}

/** One page of the replies to a comment. Pass `cursor` from a previous page to continue. */
export async function getCommentReplies(
  client: PrivateClient,
  mediaId: string,
  commentId: string,
  options: ReplyListOptions = {},
): Promise<Page<Comment>> {
  const json = await client.request({
    method: endpoints.mediaCommentReplies.method,
    endpoint: commentPath(endpoints.mediaCommentReplies, { mediaId, commentId }),
    ...(options.cursor !== undefined ? { query: { min_id: options.cursor } } : {}),
  });
  const items = parseSchemaList<Comment>(json['child_comments'] ?? [], commentSchema, 'reply');
  const next = json['next_min_child_cursor'];
  const hasMore = json['has_more_head_child_comments'] === true;
  const nextCursor = hasMore && typeof next === 'string' && next !== '' ? next : undefined;
  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

/** Walks every reply to a comment, yielding one at a time across pages. */
export function paginateCommentReplies(
  client: PrivateClient,
  mediaId: string,
  commentId: string,
): AsyncGenerator<Comment> {
  return paginate((cursor) =>
    getCommentReplies(client, mediaId, commentId, cursor !== undefined ? { cursor } : {}),
  );
}
