import { randomUUID } from 'node:crypto';
import { checkedId } from '../../core/ids';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';
import { friendshipStatusSchema, type FriendshipStatus } from '../../schemas/friendship';
import { userSchema, type User } from '../../schemas/user';
import { parseSchemaList } from '../../schemas/parse-list';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { isRecord, readCursor } from '../../core/guards';

/** Validates a friendship_status value into the typed model, or throws a typed error. */
function parseFriendship(value: unknown): FriendshipStatus {
  const parsed = friendshipStatusSchema.safeParse(value);
  if (!parsed.success) {
    throw new ClientSchemaError(
      'friendship response did not match the friendship_status schema',
      value,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

/** Follows a user by id. Returns the resulting friendship status. */
export async function followUser(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  const json = await client.request({
    method: endpoints.friendshipsCreate.method,
    endpoint: endpoints.friendshipsCreate.path.replace('{pk}', checkedId(pk, 'A user id')),
    payload: { user_id: pk },
  });
  return parseFriendship(json['friendship_status']);
}

/** Unfollows a user by id. Returns the resulting friendship status. */
export async function unfollowUser(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  const json = await client.request({
    method: endpoints.friendshipsDestroy.method,
    endpoint: endpoints.friendshipsDestroy.path.replace('{pk}', checkedId(pk, 'A user id')),
    payload: { user_id: pk },
  });
  return parseFriendship(json['friendship_status']);
}

/**
 * Reads the relationship with a user by id. `friendships/show/` returns the
 * status fields at the top level, so the whole response is validated.
 */
export async function getFriendshipStatus(
  client: PrivateClient,
  pk: string,
): Promise<FriendshipStatus> {
  const json = await client.request({
    method: endpoints.friendshipsShow.method,
    endpoint: endpoints.friendshipsShow.path.replace('{pk}', checkedId(pk, 'A user id')),
  });
  return parseFriendship(json);
}

/** Paging for a follower, following or request list. */
export interface FollowListOptions {
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly cursor?: string;
}

/** Validates the `users` array of a friendship list response into typed models. */
function parseUserList(json: Record<string, unknown>): User[] {
  const users = json['users'];
  if (!Array.isArray(users)) {
    throw new ClientSchemaError('friendship list response did not include a users array', json);
  }
  return users.map((candidate) => {
    const parsed = userSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ClientSchemaError(
        'a user in the friendship list did not match the schema',
        candidate,
        {
          cause: parsed.error,
        },
      );
    }
    return parsed.data;
  });
}

async function fetchFollowList(
  client: PrivateClient,
  definition: EndpointDefinition,
  pk: string,
  options: FollowListOptions,
): Promise<Page<User>> {
  const rankToken = `${client.session.auth.userId ?? randomUUID()}_${randomUUID()}`;
  const json = await client.request({
    method: definition.method,
    endpoint: definition.path.replace('{pk}', checkedId(pk, 'A user id')),
    query: {
      rank_token: rankToken,
      ...(options.cursor !== undefined ? { max_id: options.cursor } : {}),
    },
  });
  const items = parseUserList(json);
  const nextCursor = readCursor(json, 'next_max_id');
  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

/** One page of a user's followers. Pass `cursor` from a previous page to continue. */
export function getFollowers(
  client: PrivateClient,
  pk: string,
  options: FollowListOptions = {},
): Promise<Page<User>> {
  return fetchFollowList(client, endpoints.friendshipsFollowers, pk, options);
}

/** One page of the accounts a user follows. Pass `cursor` to continue. */
export function getFollowing(
  client: PrivateClient,
  pk: string,
  options: FollowListOptions = {},
): Promise<Page<User>> {
  return fetchFollowList(client, endpoints.friendshipsFollowing, pk, options);
}

/** Walks every follower of a user, yielding one at a time across pages. */
export function paginateFollowers(client: PrivateClient, pk: string): AsyncGenerator<User> {
  return paginate((cursor) => getFollowers(client, pk, cursor !== undefined ? { cursor } : {}));
}

/** Walks every account a user follows, yielding one at a time across pages. */
export function paginateFollowing(client: PrivateClient, pk: string): AsyncGenerator<User> {
  return paginate((cursor) => getFollowing(client, pk, cursor !== undefined ? { cursor } : {}));
}

/** Posts a friendship action by user id and returns the resulting status. */
async function friendshipAction(
  client: PrivateClient,
  definition: EndpointDefinition,
  pk: string,
): Promise<FriendshipStatus> {
  const json = await client.request({
    method: definition.method,
    endpoint: definition.path.replace('{pk}', checkedId(pk, 'A user id')),
    payload: { user_id: pk },
  });
  return parseFriendship(json['friendship_status']);
}

/** Approves a pending follow request from a user. */
export function approveRequest(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  return friendshipAction(client, endpoints.friendshipsApprove, pk);
}

/** Denies (ignores) a pending follow request from a user. */
export function denyRequest(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  return friendshipAction(client, endpoints.friendshipsIgnore, pk);
}

/** Blocks a user. */
export function blockUser(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  return friendshipAction(client, endpoints.friendshipsBlock, pk);
}

/** Unblocks a user. */
export function unblockUser(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  return friendshipAction(client, endpoints.friendshipsUnblock, pk);
}

/** One page of incoming follow requests. Pass `cursor` to continue. */
export async function getPendingRequests(
  client: PrivateClient,
  options: FollowListOptions = {},
): Promise<Page<User>> {
  const json = await client.request({
    method: endpoints.friendshipsPending.method,
    endpoint: endpoints.friendshipsPending.path,
    ...(options.cursor !== undefined ? { query: { max_id: options.cursor } } : {}),
  });
  const items = parseSchemaList<User>(json['users'], userSchema, 'user');
  const nextCursor = readCursor(json, 'next_max_id');
  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

/** Walks every incoming follow request, yielding one at a time across pages. */
export function paginatePendingRequests(client: PrivateClient): AsyncGenerator<User> {
  return paginate((cursor) => getPendingRequests(client, cursor !== undefined ? { cursor } : {}));
}

/** Which of a user's content to mute; omit both to mute posts and stories. */
export interface MuteOptions {
  readonly posts?: boolean;
  readonly stories?: boolean;
}

function muteTargets(pk: string, options: MuteOptions): Record<string, unknown> {
  const both = options.posts === undefined && options.stories === undefined;
  const posts = both || options.posts === true;
  const stories = both || options.stories === true;
  if (!posts && !stories) {
    // Sending neither target is accepted by the server and changes nothing.
    throw new IgError('Choose posts, stories, or both to mute');
  }
  return {
    ...(posts ? { target_posts_author_id: checkedId(pk, 'A user id') } : {}),
    ...(stories ? { target_reel_author_id: checkedId(pk, 'A user id') } : {}),
    container_module: 'media_mute_sheet',
  };
}

/** Mutes a user's posts and/or stories (both by default). */
export async function muteUser(
  client: PrivateClient,
  pk: string,
  options: MuteOptions = {},
): Promise<void> {
  await client.request({
    method: endpoints.friendshipsMute.method,
    endpoint: endpoints.friendshipsMute.path,
    payload: muteTargets(pk, options),
  });
}

/** Unmutes a user's posts and/or stories (both by default). */
export async function unmuteUser(
  client: PrivateClient,
  pk: string,
  options: MuteOptions = {},
): Promise<void> {
  await client.request({
    method: endpoints.friendshipsUnmute.method,
    endpoint: endpoints.friendshipsUnmute.path,
    payload: muteTargets(pk, options),
  });
}

/** Removes a user from the account's followers (they stop following it, without a block). */
export function removeFollower(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  return friendshipAction(client, endpoints.friendshipsRemoveFollower, pk);
}

/** Adds or removes a user on the close friends list and returns their new status. */
async function setCloseFriend(
  client: PrivateClient,
  pk: string,
  add: boolean,
): Promise<FriendshipStatus> {
  if (!/^\d+$/.test(pk)) {
    throw new IgError('A user id must be numeric');
  }
  const json = await client.request({
    method: endpoints.friendshipsSetBesties.method,
    endpoint: endpoints.friendshipsSetBesties.path,
    payload: {
      block_on_empty_thread_creation: 'false',
      module: 'CLOSE_FRIENDS_V2_SEARCH',
      source: 'audience_manager',
      ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
      remove: add ? [] : [pk],
      add: add ? [pk] : [],
    },
  });
  const statuses = json['friendship_statuses'];
  return parseFriendship(isRecord(statuses) ? statuses[pk] : undefined);
}

/** Adds a user to the close friends list. */
export function addCloseFriend(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  return setCloseFriend(client, pk, true);
}

/** Removes a user from the close friends list. */
export function removeCloseFriend(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  return setCloseFriend(client, pk, false);
}
