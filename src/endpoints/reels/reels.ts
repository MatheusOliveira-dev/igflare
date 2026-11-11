import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';
import { checkedId } from '../../core/ids';
import { isRecord } from '../../core/guards';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { mediaSchema, type Media } from '../../schemas/media';
import { ClientSchemaError } from '../../errors/api-errors';

const PAGE_SIZE = 12;

/** Paging for a reels feed. */
export interface ReelsPageOptions {
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly cursor?: string;
}

/** Paging for a user's reels. */
export interface UserReelsOptions extends ReelsPageOptions {
  /** How many reels a page holds. The app asks for 12. */
  readonly pageSize?: number;
}

/**
 * The reels of an answer, whatever it calls the list. The discovery feed mixes in ads
 * under `items_with_ads` and entries with no media. Those are left out.
 */
function reelsOf(json: Record<string, unknown>): Media[] {
  const items = json['items'];
  const withAds = json['items_with_ads'];
  const list: unknown[] = [
    ...(Array.isArray(items) ? (items as unknown[]) : []),
    ...(Array.isArray(withAds) ? (withAds as unknown[]) : []),
  ];
  const medias: Media[] = [];
  for (const entry of list) {
    const candidate = isRecord(entry) ? entry['media'] : undefined;
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const parsed = mediaSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ClientSchemaError('a reel did not match the schema', candidate, {
        cause: parsed.error,
      });
    }
    medias.push(parsed.data);
  }
  if (!Array.isArray(items) && !Array.isArray(withAds)) {
    throw new ClientSchemaError('the reels answer did not include a list', json);
  }
  return medias;
}

function pageOf(items: Media[], json: Record<string, unknown>): Page<Media> {
  const paging = json['paging_info'];
  const next = isRecord(paging) ? paging['max_id'] : undefined;
  const more = isRecord(paging) ? paging['more_available'] : undefined;
  return typeof next === 'string' && next !== '' && more === true
    ? { items, nextCursor: next }
    : { items };
}

/** One page of a user's reels. Pass `cursor` to continue. */
export async function getUserReels(
  client: PrivateClient,
  userId: string,
  options: UserReelsOptions = {},
): Promise<Page<Media>> {
  const size = options.pageSize ?? PAGE_SIZE;
  const json = await client.request({
    method: endpoints.clipsUser.method,
    endpoint: endpoints.clipsUser.path,
    payload: {
      target_user_id: checkedId(userId, 'A user id'),
      max_id: options.cursor ?? '',
      page_size: String(Math.max(1, Math.min(50, Math.floor(size)))),
      include_feed_video: 'true',
    },
  });
  return pageOf(reelsOf(json), json);
}

/** Walks a user's reels, one at a time across pages. */
export function paginateUserReels(client: PrivateClient, userId: string): AsyncGenerator<Media> {
  return paginate((cursor) => getUserReels(client, userId, cursor !== undefined ? { cursor } : {}));
}

async function reelsFeed(
  client: PrivateClient,
  definition: EndpointDefinition,
  options: ReelsPageOptions,
): Promise<Page<Media>> {
  const json = await client.request({
    method: definition.method,
    endpoint: definition.path,
    query: { max_id: options.cursor ?? '' },
    payload: {},
  });
  return pageOf(reelsOf(json), json);
}

/** One page of the Reels tab feed. */
export function getReelsFeed(
  client: PrivateClient,
  options: ReelsPageOptions = {},
): Promise<Page<Media>> {
  return reelsFeed(client, endpoints.clipsConnected, options);
}

/** One page of the reels Instagram suggests (the explore reels). */
export function getExploreReels(
  client: PrivateClient,
  options: ReelsPageOptions = {},
): Promise<Page<Media>> {
  return reelsFeed(client, endpoints.clipsDiscover, options);
}

/** One page of the reels friends interacted with. */
export function getFriendsReels(
  client: PrivateClient,
  options: ReelsPageOptions = {},
): Promise<Page<Media>> {
  return reelsFeed(client, endpoints.clipsDiscoverSocial, options);
}

/** Walks the Reels tab feed, one reel at a time across pages. */
export function paginateReelsFeed(client: PrivateClient): AsyncGenerator<Media> {
  return paginate((cursor) => getReelsFeed(client, cursor !== undefined ? { cursor } : {}));
}

/** Walks the explore reels, one at a time across pages. */
export function paginateExploreReels(client: PrivateClient): AsyncGenerator<Media> {
  return paginate((cursor) => getExploreReels(client, cursor !== undefined ? { cursor } : {}));
}
