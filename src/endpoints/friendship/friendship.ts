import { randomUUID } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';
import { friendshipStatusSchema, type FriendshipStatus } from '../../schemas/friendship';
import { userSchema, type User } from '../../schemas/user';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { ClientSchemaError } from '../../errors/api-errors';

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
    endpoint: endpoints.friendshipsCreate.path.replace('{pk}', pk),
    payload: { user_id: pk },
  });
  return parseFriendship(json['friendship_status']);
}

/** Unfollows a user by id. Returns the resulting friendship status. */
export async function unfollowUser(client: PrivateClient, pk: string): Promise<FriendshipStatus> {
  const json = await client.request({
    method: endpoints.friendshipsDestroy.method,
    endpoint: endpoints.friendshipsDestroy.path.replace('{pk}', pk),
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
    endpoint: endpoints.friendshipsShow.path.replace('{pk}', pk),
  });
  return parseFriendship(json);
}

export interface FollowListOptions {
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly maxId?: string;
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

/** Reads the next-page cursor from a list response, or undefined on the last page. */
function readNextCursor(json: Record<string, unknown>): string | undefined {
  const next = json['next_max_id'];
  return typeof next === 'string' || typeof next === 'number' ? String(next) : undefined;
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
    endpoint: definition.path.replace('{pk}', pk),
    query: {
      rank_token: rankToken,
      ...(options.maxId !== undefined ? { max_id: options.maxId } : {}),
    },
  });
  const items = parseUserList(json);
  const nextCursor = readNextCursor(json);
  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

/** One page of a user's followers. Pass `maxId` from a previous page to continue. */
export function getFollowers(
  client: PrivateClient,
  pk: string,
  options: FollowListOptions = {},
): Promise<Page<User>> {
  return fetchFollowList(client, endpoints.friendshipsFollowers, pk, options);
}

/** One page of the accounts a user follows. Pass `maxId` to continue. */
export function getFollowing(
  client: PrivateClient,
  pk: string,
  options: FollowListOptions = {},
): Promise<Page<User>> {
  return fetchFollowList(client, endpoints.friendshipsFollowing, pk, options);
}

/** Walks every follower of a user, yielding one at a time across pages. */
export function paginateFollowers(client: PrivateClient, pk: string): AsyncGenerator<User> {
  return paginate((maxId) => getFollowers(client, pk, maxId !== undefined ? { maxId } : {}));
}

/** Walks every account a user follows, yielding one at a time across pages. */
export function paginateFollowing(client: PrivateClient, pk: string): AsyncGenerator<User> {
  return paginate((maxId) => getFollowing(client, pk, maxId !== undefined ? { maxId } : {}));
}
