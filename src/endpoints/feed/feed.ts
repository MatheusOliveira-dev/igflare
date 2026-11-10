import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { mediaSchema, type Media } from '../../schemas/media';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { ClientSchemaError } from '../../errors/api-errors';

export interface FeedOptions {
  /** The cursor from a previous page's `nextMaxId`. Omit for the first page. */
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
function readNextMaxId(json: Record<string, unknown>): string | undefined {
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
  const nextMaxId = readNextMaxId(json);
  return nextMaxId !== undefined ? { items, nextMaxId } : { items };
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
  const next = readNextMaxId(json);
  const moreAvailable = json['more_available'];
  return next !== undefined && moreAvailable !== false ? { items, nextMaxId: next } : { items };
}

/** Walks the home timeline, yielding one media at a time across pages. */
export function paginateTimeline(client: PrivateClient): AsyncGenerator<Media> {
  return paginate((maxId) => getTimelineFeed(client, maxId !== undefined ? { maxId } : {}));
}
