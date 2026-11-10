import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { mediaSchema, type Media } from '../../schemas/media';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { ClientSchemaError } from '../../errors/api-errors';

export interface FeedOptions {
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly maxId?: string;
}

/** Validates the `items` array of a feed response into typed Media models. */
function parseMediaList(json: Record<string, unknown>): Media[] {
  const items = json['items'];
  if (!Array.isArray(items)) {
    throw new ClientSchemaError('feed response did not include an items array', json);
  }
  return items.map((candidate) => {
    const parsed = mediaSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ClientSchemaError('a media item in the feed did not match the schema', candidate, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  });
}

/** Reads the next-page cursor from a feed response, or undefined on the last page. */
function readNextCursor(json: Record<string, unknown>): string | undefined {
  const next = json['next_max_id'];
  return typeof next === 'string' || typeof next === 'number' ? String(next) : undefined;
}

/** One page of a user's own posts. Pass `maxId` from a previous page to continue. */
export async function getUserFeed(
  client: PrivateClient,
  pk: string,
  options: FeedOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.feedUser.method,
    endpoint: endpoints.feedUser.path.replace('{pk}', pk),
    ...(options.maxId !== undefined ? { query: { max_id: options.maxId } } : {}),
  });
  const items = parseMediaList(json);
  const nextCursor = readNextCursor(json);
  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

/** Walks every post of a user, yielding one at a time across pages. */
export function paginateUserFeed(client: PrivateClient, pk: string): AsyncGenerator<Media> {
  return paginate((maxId) => getUserFeed(client, pk, maxId !== undefined ? { maxId } : {}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extracts the media list from a timeline response. Newer builds wrap each item in
 * `feed_items[].media_or_ad` (alongside non-media entries like suggested users and
 * the end-of-feed marker, which are skipped); older builds return a flat `items`.
 */
function timelineMediaCandidates(json: Record<string, unknown>): unknown[] {
  const feedItems = json['feed_items'];
  if (Array.isArray(feedItems)) {
    return feedItems
      .map((entry) => (isRecord(entry) ? entry['media_or_ad'] : undefined))
      .filter((media) => media !== undefined);
  }
  const items = json['items'];
  if (Array.isArray(items)) {
    return items;
  }
  throw new ClientSchemaError('timeline response had neither feed_items nor items', json);
}

/** One page of the home timeline. Pass `maxId` from a previous page to continue. */
export async function getTimelineFeed(
  client: PrivateClient,
  options: FeedOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.feedTimeline.method,
    endpoint: endpoints.feedTimeline.path,
    payload: {
      reason: options.maxId !== undefined ? 'pagination' : 'cold_start_fetch',
      is_pull_to_refresh: '0',
      ...(options.maxId !== undefined ? { max_id: options.maxId } : {}),
    },
  });
  const items = timelineMediaCandidates(json).map((candidate) => {
    const parsed = mediaSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ClientSchemaError('a timeline media did not match the schema', candidate, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  });
  const next = readNextCursor(json);
  const moreAvailable = json['more_available'];
  return next !== undefined && moreAvailable !== false ? { items, nextCursor: next } : { items };
}

/** Walks the home timeline, yielding one media at a time across pages. */
export function paginateTimeline(client: PrivateClient): AsyncGenerator<Media> {
  return paginate((maxId) => getTimelineFeed(client, maxId !== undefined ? { maxId } : {}));
}

/**
 * Flattens the media out of a `sections` response. Hashtag and location feeds
 * (the `tags/{tag}/sections/` and `locations/{id}/sections/` endpoints that
 * replaced the retired `feed/tag` and `feed/location`) group media into sections;
 * the grid media live under each section's `layout_content.medias[].media`.
 */
function sectionMedias(section: unknown): unknown[] {
  const content = isRecord(section) ? section['layout_content'] : undefined;
  const medias = isRecord(content) ? content['medias'] : undefined;
  if (!Array.isArray(medias)) {
    return [];
  }
  return medias
    .map((entry) => (isRecord(entry) ? entry['media'] : undefined))
    .filter((media) => media !== undefined);
}

function sectionsMediaCandidates(json: Record<string, unknown>): unknown[] {
  const sections = json['sections'];
  if (!Array.isArray(sections)) {
    throw new ClientSchemaError('sections response did not include a sections array', json);
  }
  return sections.flatMap(sectionMedias);
}

/** Builds a Page<Media> from a sectioned feed response, honoring `more_available`. */
function sectionsPage(json: Record<string, unknown>): Page<Media> {
  const items = sectionsMediaCandidates(json).map((candidate) => {
    const parsed = mediaSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ClientSchemaError('a sectioned media did not match the schema', candidate, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  });
  const next = readNextCursor(json);
  return next !== undefined && json['more_available'] !== false
    ? { items, nextCursor: next }
    : { items };
}

/** The POST body a `sections` feed takes: the recent tab, plus the cursor if any. */
function sectionsBody(maxId: string | undefined): Record<string, unknown> {
  return {
    tab: 'recent',
    supported_tabs: JSON.stringify(['top', 'recent']),
    include_persistent: true,
    ...(maxId !== undefined ? { max_id: maxId, page: maxId } : {}),
  };
}

/** One page of a hashtag's recent media. Pass `maxId` to continue. */
export async function getHashtagFeed(
  client: PrivateClient,
  tag: string,
  options: FeedOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.tagsSections.method,
    endpoint: endpoints.tagsSections.path.replace('{tag}', encodeURIComponent(tag)),
    payload: sectionsBody(options.maxId),
  });
  return sectionsPage(json);
}

/** Walks a hashtag's media, yielding one at a time across pages. */
export function paginateHashtagFeed(client: PrivateClient, tag: string): AsyncGenerator<Media> {
  return paginate((maxId) => getHashtagFeed(client, tag, maxId !== undefined ? { maxId } : {}));
}

/** One page of a location's recent media. Pass `maxId` to continue. */
export async function getLocationFeed(
  client: PrivateClient,
  locationId: string,
  options: FeedOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.locationsSections.method,
    endpoint: endpoints.locationsSections.path.replace('{id}', locationId),
    payload: sectionsBody(options.maxId),
  });
  return sectionsPage(json);
}

/** Walks a location's media, yielding one at a time across pages. */
export function paginateLocationFeed(
  client: PrivateClient,
  locationId: string,
): AsyncGenerator<Media> {
  return paginate((maxId) =>
    getLocationFeed(client, locationId, maxId !== undefined ? { maxId } : {}),
  );
}
