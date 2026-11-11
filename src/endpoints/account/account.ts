import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { userSchema, type User } from '../../schemas/user';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { getCurrentUser } from '../user/current-user';

/** Sets the logged-in account's biography and returns the updated profile. */
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

/**
 * Fields `accounts/edit_profile/` wants on every call. Sending only the one being
 * changed is refused ("You need an email or confirmed phone number"), so the rest are
 * read back from the account and sent unchanged.
 */
const KEPT_FIELDS = ['username', 'biography', 'email', 'phone_number', 'external_url'] as const;

/**
 * Changes the display name of the logged-in account and returns the updated profile.
 * Instagram allows only a couple of name changes per 14 days; a refused change throws
 * the server's own message.
 */
export async function setName(client: PrivateClient, name: string): Promise<User> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new IgError('A name cannot be empty');
  }
  const current = await getCurrentUser(client);
  const payload: Record<string, string> = { first_name: trimmed };
  for (const field of KEPT_FIELDS) {
    const value = current[field];
    payload[field] = typeof value === 'string' ? value : '';
  }
  const json = await client.request({
    method: endpoints.accountsEditProfile.method,
    endpoint: endpoints.accountsEditProfile.path,
    payload,
  });
  const parsed = userSchema.safeParse(json['user']);
  if (!parsed.success) {
    throw new ClientSchemaError(
      'edit_profile response did not include a valid user',
      json['user'],
      {
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
}
