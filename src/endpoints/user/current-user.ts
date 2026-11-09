import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { IgError } from '../../errors/ig-error';

/**
 * Fetches the logged-in account's own profile. Requires a logged-in session; it
 * is the simplest way to confirm the captured authorization is accepted.
 */
export async function getCurrentUser(client: PrivateClient): Promise<Record<string, unknown>> {
  const json = await client.request({
    method: endpoints.accountsCurrentUser.method,
    endpoint: endpoints.accountsCurrentUser.path,
    query: { edit: 'true' },
  });
  const user = json['user'];
  if (typeof user !== 'object' || user === null) {
    throw new IgError('current_user response did not include a user');
  }
  return user as Record<string, unknown>;
}
