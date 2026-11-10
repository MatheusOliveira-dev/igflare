import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { userSchema, type User } from '../../schemas/user';
import { ClientSchemaError } from '../../errors/api-errors';

/**
 * Sets the logged-in account's biography and returns the updated profile. Only
 * the bio is changed; editing the name or link (the full edit_profile body) is
 * not wired yet.
 */
export async function setBiography(client: PrivateClient, text: string): Promise<User> {
  const json = await client.request({
    method: endpoints.accountsSetBiography.method,
    endpoint: endpoints.accountsSetBiography.path,
    payload: { raw_text: text },
  });
  const parsed = userSchema.safeParse(json['user']);
  if (!parsed.success) {
    throw new ClientSchemaError(
      'set_biography response did not include a valid user',
      json['user'],
      {
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
}
