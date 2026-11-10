import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { friendshipStatusSchema, type FriendshipStatus } from '../../schemas/friendship';
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
