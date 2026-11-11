import { checkedIds } from '../../core/ids';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { userSchema, type User } from '../../schemas/user';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { bioLinkSchema, type BioLink } from '../../schemas/bio-link';
import { parseSchemaList } from '../../schemas/parse-list';
import { activityItemSchema, type Activity, type ActivityItem } from '../../schemas/activity';
import { isRecord } from '../../core/guards';
import { getCurrentUser } from '../user/current-user';
import { uploadStandalonePhoto } from '../upload/upload';

/** The updated profile an account edit answers with. */
function updatedUser(json: Record<string, unknown>, what: string): User {
  const parsed = userSchema.safeParse(json['user']);
  if (!parsed.success) {
    throw new ClientSchemaError(`${what} response did not include a valid user`, json['user'], {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** Sets the logged-in account's biography and returns the updated profile. */
export async function setBiography(client: PrivateClient, text: string): Promise<User> {
  const json = await client.request({
    method: endpoints.accountsSetBiography.method,
    endpoint: endpoints.accountsSetBiography.path,
    payload: { raw_text: text },
  });
  return updatedUser(json, 'set_biography');
}

/** Replaces the profile picture with a JPEG and returns the updated profile. */
export async function setProfilePicture(client: PrivateClient, jpeg: Uint8Array): Promise<User> {
  const uploadId = await uploadStandalonePhoto(client, jpeg);
  const json = await client.request({
    method: endpoints.accountsChangeProfilePicture.method,
    endpoint: endpoints.accountsChangeProfilePicture.path,
    payload: { use_fbuploader: 'true', upload_id: uploadId },
  });
  return updatedUser(json, 'change_profile_picture');
}

/** Removes the profile picture (back to the default avatar) and returns the updated profile. */
export async function removeProfilePicture(client: PrivateClient): Promise<User> {
  const json = await client.request({
    method: endpoints.accountsRemoveProfilePicture.method,
    endpoint: endpoints.accountsRemoveProfilePicture.path,
    payload: {},
  });
  return updatedUser(json, 'remove_profile_picture');
}

/**
 * Fields `accounts/edit_profile/` wants on every call. Sending only the one being
 * changed is refused ("You need an email or confirmed phone number"), so the rest are
 * read back from the account and sent unchanged.
 */
const KEPT_FIELDS = ['username', 'biography', 'email', 'phone_number', 'external_url'] as const;

/**
 * Changes the display name of the logged-in account and returns the updated profile.
 * Instagram allows only a couple of name changes per 14 days. A refused change throws
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
  return updatedUser(json, 'edit_profile');
}

/** The links listed on the logged-in profile (empty when there are none). */
export async function getBioLinks(client: PrivateClient): Promise<BioLink[]> {
  const current = await getCurrentUser(client);
  return parseSchemaList<BioLink>(current['bio_links'] ?? [], bioLinkSchema, 'bio link');
}

/**
 * Sets the profile link and returns the list as the profile now holds it. The profile
 * keeps a list. This adds an external link to it. \`accounts/edit_profile/\` ignores
 * \`external_url\`, which is why this goes through its own endpoint.
 */
export async function setBioLink(
  client: PrivateClient,
  url: string,
  title = '',
): Promise<BioLink[]> {
  if (!/^https?:\/\//i.test(url)) {
    throw new IgError('A profile link must start with http:// or https://');
  }
  await client.request({
    method: endpoints.accountsUpdateBioLinks.method,
    endpoint: endpoints.accountsUpdateBioLinks.path,
    payload: { updated_links: JSON.stringify([{ url, title, link_type: 'external' }]) },
  });
  return getBioLinks(client);
}

/** Removes profile links by id (the `link_id` of each entry in {@link getBioLinks}). */
export async function removeBioLinks(
  client: PrivateClient,
  linkIds: readonly string[],
): Promise<BioLink[]> {
  checkedIds(linkIds, 'Link ids');
  // The endpoint takes the ids as JSON numbers. Link ids seen so far fit in a double;
  // one that does not would be rounded into a different link, so it is refused.
  const numbers = linkIds.map(Number);
  if (!numbers.every(Number.isSafeInteger)) {
    throw new IgError('A link id is too large to send safely');
  }
  await client.request({
    method: endpoints.accountsRemoveBioLinks.method,
    endpoint: endpoints.accountsRemoveBioLinks.path,
    payload: { link_ids: numbers },
  });
  return getBioLinks(client);
}

function activityItems(value: unknown, what: string): ActivityItem[] {
  return parseSchemaList<ActivityItem>(value ?? [], activityItemSchema, what);
}

/**
 * Reads the activity feed (likes, comments, new followers, mentions): what is new and
 * what was already seen, first page. It never marks anything as seen.
 */
export async function getActivity(client: PrivateClient): Promise<Activity> {
  const json = await client.request({
    method: endpoints.newsInbox.method,
    endpoint: endpoints.newsInbox.path,
    query: { mark_as_seen: 'false' },
  });
  const requests = Array.isArray(json['friend_request_stories'])
    ? json['friend_request_stories']
    : [];
  const first: unknown = requests[0];
  const args = isRecord(first) ? first['args'] : undefined;
  const count = isRecord(args) ? args['request_count'] : undefined;
  return {
    newItems: activityItems(json['new_stories'], 'new activity'),
    oldItems: activityItems(json['old_stories'], 'old activity'),
    friendRequestCount: typeof count === 'number' ? count : 0,
  };
}
