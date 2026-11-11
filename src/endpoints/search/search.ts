import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { userSchema, type User } from '../../schemas/user';
import { hashtagSchema, type Hashtag } from '../../schemas/hashtag';
import {
  locationSchema,
  type Location,
  locationInfoSchema,
  type LocationInfo,
} from '../../schemas/location';
import { parseSchemaList } from '../../schemas/parse-list';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { checkedId } from '../../core/ids';
import { isRecord } from '../../core/guards';

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

/** A hashtag as a person types it: with or without the leading `#`, one word. */
function tagName(tag: string): string {
  const name = tag.trim().replace(/^#/, '');
  if (name === '' || /[\s#/?]/.test(name)) {
    throw new IgError('A hashtag is one word, with or without the leading #');
  }
  return name;
}

/**
 * What a hashtag's page shows: its name and how many posts use it. Following a hashtag
 * is not offered: Instagram retired it, and the old calls only answer ok without effect.
 */
export async function getHashtagInfo(client: PrivateClient, tag: string): Promise<Hashtag> {
  const json = await client.request({
    method: endpoints.tagsInfo.method,
    endpoint: endpoints.tagsInfo.path.replace('{tag}', encodeURIComponent(tagName(tag))),
  });
  const parsed = hashtagSchema.safeParse(json);
  if (!parsed.success || parsed.data.name === undefined) {
    throw new ClientSchemaError('the hashtag info did not match the schema', json, {
      cause: parsed.success ? undefined : parsed.error,
    });
  }
  return parsed.data;
}

/** A location's own page: contact details, category and how many posts are tagged there. */
export async function getLocationInfo(
  client: PrivateClient,
  locationId: string,
): Promise<LocationInfo> {
  const json = await client.request({
    method: endpoints.locationsInfo.method,
    endpoint: endpoints.locationsInfo.path.replace('{id}', checkedId(locationId, 'A location id')),
  });
  const parsed = locationInfoSchema.safeParse(json);
  if (!parsed.success || parsed.data.name === undefined || parsed.data.name === '') {
    // An unknown id is answered with an empty page rather than an error.
    throw new ClientSchemaError('the location has no page', json, {
      cause: parsed.success ? undefined : parsed.error,
    });
  }
  return parsed.data;
}

/** The places near a coordinate, nearest first as the server ranks them. */
export async function searchNearby(
  client: PrivateClient,
  latitude: number,
  longitude: number,
): Promise<Location[]> {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new IgError('Latitude is -90 to 90 and longitude is -180 to 180');
  }
  const json = await client.request({
    method: endpoints.locationSearch.method,
    endpoint: endpoints.locationSearch.path,
    query: { latitude: String(latitude), longitude: String(longitude) },
  });
  const venues = Array.isArray(json['venues']) ? (json['venues'] as unknown[]) : [];
  const places = venues.map((venue) =>
    isRecord(venue)
      ? {
          // A place lists its id as `external_id`. Every other call calls it `pk`.
          pk: venue['external_id'],
          lat: latitude,
          lng: longitude,
          ...venue,
        }
      : venue,
  );
  return parseSchemaList<Location>(places, locationSchema, 'nearby place');
}
