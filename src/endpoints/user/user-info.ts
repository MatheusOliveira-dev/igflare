import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { userSchema, type User } from '../../schemas/user';
import { IgError } from '../../errors/ig-error';
import { ClientSchemaError } from '../../errors/api-errors';

/** Validates the `user` node of a user-info response into the typed model. */
function parseUser(json: Record<string, unknown>): User {
  const user = json['user'];
  if (typeof user !== 'object' || user === null) {
    throw new IgError('user_info response did not include a user');
  }
  const parsed = userSchema.safeParse(user);
  if (!parsed.success) {
    throw new ClientSchemaError('user_info response did not match the user schema', user, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/**
 * Fetches a user's profile by id. Returns the validated `User` model; a missing
 * user or a response that does not match the schema surfaces as a typed error.
 */
export async function getUserInfo(client: PrivateClient, pk: string): Promise<User> {
  const json = await client.request({
    method: endpoints.userInfo.method,
    endpoint: endpoints.userInfo.path.replace('{pk}', pk),
  });
  return parseUser(json);
}

/** Fetches a user's profile by username. Returns the same validated `User` model. */
export async function getUserInfoByUsername(
  client: PrivateClient,
  username: string,
): Promise<User> {
  const json = await client.request({
    method: endpoints.userInfoByUsername.method,
    endpoint: endpoints.userInfoByUsername.path.replace('{username}', username),
  });
  return parseUser(json);
}
