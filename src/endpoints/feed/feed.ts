import type { PrivateClient } from '../../core/http/private-client';
import { checkedId } from '../../core/ids';
import { endpoints } from '../../generated/endpoints';
import { mediaSchema, type Media } from '../../schemas/media';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { isRecord, readCursor } from '../../core/guards';
import { getHashtagSerpPage } from './hashtag-serp';

export interface FeedOptions {
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly cursor?: string;
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

/** One page of a user's own posts. Pass `cursor` from a previous page to continue. */
export async function getUserFeed(
  client: PrivateClient,
  pk: string,
  options: FeedOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.feedUser.method,
    endpoint: endpoints.feedUser.path.replace('{pk}', checkedId(pk, 'A user id')),
    ...(options.cursor !== undefined ? { query: { max_id: options.cursor } } : {}),
  });
  const items = parseMediaList(json);
  const nextCursor = readCursor(json, 'next_max_id');
  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

/** Walks every post of a user, yielding one at a time across pages. */
export function paginateUserFeed(client: PrivateClient, pk: string): AsyncGenerator<Media> {
  return paginate((cursor) => getUserFeed(client, pk, cursor !== undefined ? { cursor } : {}));
}

/**
 * Extracts the media list from a timeline response. Newer builds wrap each item in
 * `feed_items[].media_or_ad` (alongside non-media entries like suggested users and
 * the end-of-feed marker, which are skipped). Older builds return a flat `items`.
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

/** One page of the home timeline. Pass `cursor` from a previous page to continue. */
export async function getTimelineFeed(
  client: PrivateClient,
  options: FeedOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.feedTimeline.method,
    endpoint: endpoints.feedTimeline.path,
    payload: {
      reason: options.cursor !== undefined ? 'pagination' : 'cold_start_fetch',
      is_pull_to_refresh: '0',
      ...(options.cursor !== undefined ? { max_id: options.cursor } : {}),
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
  const next = readCursor(json, 'next_max_id');
  const moreAvailable = json['more_available'];
  return next !== undefined && moreAvailable !== false ? { items, nextCursor: next } : { items };
}

/** Walks the home timeline, yielding one media at a time across pages. */
export function paginateTimeline(client: PrivateClient): AsyncGenerator<Media> {
  return paginate((cursor) => getTimelineFeed(client, cursor !== undefined ? { cursor } : {}));
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
  const next = encodeSectionsCursor(json);
  return next !== undefined && json['more_available'] !== false
    ? { items, nextCursor: next }
    : { items };
}

/** What a `sections` page needs echoed back to return the page after it. */
interface SectionsCursor {
  readonly maxId: string;
  readonly page: number;
  readonly mediaIds: readonly string[];
}

/**
 * Packs the three values a sections response gives for the next page into one opaque
 * cursor. Sending only `max_id` (as the first version did) is answered with a 500;
 * the server also wants `page` and `next_media_ids` back.
 */
function encodeSectionsCursor(json: Record<string, unknown>): string | undefined {
  const maxId = json['next_max_id'];
  if (typeof maxId !== 'string' || maxId === '') {
    return undefined;
  }
  const page = typeof json['next_page'] === 'number' ? json['next_page'] : 0;
  const ids = json['next_media_ids'];
  const mediaIds = Array.isArray(ids) ? ids.map(String) : [];
  const cursor: SectionsCursor = { maxId, page, mediaIds };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeSectionsCursor(value: string): SectionsCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      isRecord(parsed) &&
      typeof parsed['maxId'] === 'string' &&
      typeof parsed['page'] === 'number' &&
      Array.isArray(parsed['mediaIds'])
    ) {
      return {
        maxId: parsed['maxId'],
        page: parsed['page'],
        mediaIds: parsed['mediaIds'].map(String),
      };
    }
  } catch {
    // fall through to the typed error below
  }
  throw new IgError('The cursor does not come from a hashtag or location feed page');
}

/** The POST body a `sections` feed takes: the recent tab, plus the cursor if any. */
function sectionsBody(cursor: string | undefined): Record<string, unknown> {
  const next = cursor !== undefined ? decodeSectionsCursor(cursor) : undefined;
  return {
    tab: 'recent',
    supported_tabs: JSON.stringify(['top', 'recent']),
    include_persistent: true,
    ...(next !== undefined
      ? { max_id: next.maxId, page: next.page, next_media_ids: JSON.stringify(next.mediaIds) }
      : {}),
  };
}

/**
 * One page of the posts listed for a hashtag, ranked by relevance (there is no
 * chronological view). Posts come in the light form the search grid uses. See
 * `getHashtagSerpPage`. Pass `cursor` to continue.
 */
export function getHashtagFeed(
  client: PrivateClient,
  tag: string,
  options: FeedOptions = {},
): Promise<Page<Media>> {
  return getHashtagSerpPage(client, tag, options.cursor);
}

/** Walks a hashtag's media, yielding one at a time across pages. */
export function paginateHashtagFeed(client: PrivateClient, tag: string): AsyncGenerator<Media> {
  return paginate((cursor) => getHashtagFeed(client, tag, cursor !== undefined ? { cursor } : {}));
}

/** One page of a location's recent media. Pass `cursor` to continue. */
export async function getLocationFeed(
  client: PrivateClient,
  locationId: string,
  options: FeedOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.locationsSections.method,
    endpoint: endpoints.locationsSections.path.replace(
      '{id}',
      checkedId(locationId, 'A location id'),
    ),
    payload: sectionsBody(options.cursor),
  });
  return sectionsPage(json);
}

/** Walks a location's media, yielding one at a time across pages. */
export function paginateLocationFeed(
  client: PrivateClient,
  locationId: string,
): AsyncGenerator<Media> {
  return paginate((cursor) =>
    getLocationFeed(client, locationId, cursor !== undefined ? { cursor } : {}),
  );
}
