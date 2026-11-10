import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { userSchema, type User } from '../../schemas/user';
import { hashtagSchema, type Hashtag } from '../../schemas/hashtag';
import { locationSchema, type Location } from '../../schemas/location';
import { parseSchemaList } from '../../schemas/parse-list';
import { ClientSchemaError } from '../../errors/api-errors';

/** Searches users by a free-text query, returning the ranked matches. */
export async function searchUsers(client: PrivateClient, query: string): Promise<User[]> {
  const json = await client.request({
    method: endpoints.usersSearch.method,
    endpoint: endpoints.usersSearch.path,
    query: { q: query, count: '30' },
  });
  return parseSchemaList<User>(json['users'], userSchema, 'user');
}

/** Searches hashtags by a free-text query, returning the ranked matches. */
export async function searchHashtags(client: PrivateClient, query: string): Promise<Hashtag[]> {
  const json = await client.request({
    method: endpoints.tagsSearch.method,
    endpoint: endpoints.tagsSearch.path,
    query: { q: query },
  });
  return parseSchemaList<Hashtag>(json['results'], hashtagSchema, 'hashtag');
}

/** Searches places by a free-text query, returning the matched locations. */
export async function searchPlaces(client: PrivateClient, query: string): Promise<Location[]> {
  const json = await client.request({
    method: endpoints.fbsearchPlaces.method,
    endpoint: endpoints.fbsearchPlaces.path,
    query: { query, search_surface: 'places_search_page' },
  });
  const items = json['items'];
  if (!Array.isArray(items)) {
    throw new ClientSchemaError('places search response did not include an items array', json);
  }
  const locations = items
    .map((item) =>
      typeof item === 'object' && item !== null
        ? (item as Record<string, unknown>)['location']
        : undefined,
    )
    .filter((location) => location !== undefined);
  return parseSchemaList<Location>(locations, locationSchema, 'location');
}
