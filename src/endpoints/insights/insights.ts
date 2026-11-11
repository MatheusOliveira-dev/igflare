import type { PrivateClient } from '../../core/http/private-client';
import { pandoRequest, pandoRoot, stripPandoMarkers } from '../../core/http/pando';
import { checkedMediaId } from '../../core/ids';
import { isRecord } from '../../core/guards';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import {
  accountInsightsSchema,
  audienceInsightsSchema,
  contentPageSchema,
  mediaInsightsSchema,
  type AccountInsights,
  type AudienceInsights,
  type ContentInsight,
  type MediaInsights,
} from '../../schemas/insights';
import { ClientSchemaError, IgApiError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

// Persisted-query ids of the app build this client reports (454); a new build can change
// them, and the symptom is a typed error from these calls.
interface InsightsQuery {
  readonly friendlyName: string;
  readonly docId: string;
  readonly rootField: string;
}

const POST: InsightsQuery = {
  friendlyName: 'PostInsightsQuery',
  docId: '187673829817521675190278983686',
  rootField: 'ig_post_insights',
};
const REEL: InsightsQuery = {
  friendlyName: 'ReelInsightsQuery',
  docId: '34117726174753558798011202277',
  rootField: 'ig_reel_insights',
};
const ACCOUNT_ROOT = 'ig_account_insights';
const OVERVIEW: InsightsQuery = {
  friendlyName: 'AccountInsightsOverviewQuery',
  docId: '297851856213787890962497531867',
  rootField: ACCOUNT_ROOT,
};
const AUDIENCE: InsightsQuery = {
  friendlyName: 'AccountInsightsAudienceQuery',
  docId: '11313478377027549324232575805',
  rootField: ACCOUNT_ROOT,
};
const CONTENT: InsightsQuery = {
  friendlyName: 'AccountInsightsContentQuery',
  docId: '246019450711285746558777381992',
  rootField: ACCOUNT_ROOT,
};

const DAY_SECONDS = 86_400;
const DEFAULT_RANGE_DAYS = 30;
const DEFAULT_PAGE_SIZE = 10;

/** A moment as a `Date` or as Unix seconds. */
export type InsightsTime = Date | number;

/** The dates an account report covers. It ends now and starts 30 days earlier by default. */
export interface InsightsRange {
  readonly from?: InsightsTime;
  readonly to?: InsightsTime;
}

/** The kind of media the content list holds. Leave it out for all of them. */
export type InsightsContentType = 'posts' | 'reels' | 'stories' | 'live_videos';

export interface ContentInsightsOptions extends InsightsRange {
  readonly type?: InsightsContentType;
  /** The figure to rank by: `views`, `viewers`, `follows`, `likes`, `comments`, ... Default `views`. */
  readonly metric?: string;
  /** Sort by publication time instead of by `metric`. */
  readonly sortByDate?: boolean;
  /** Smallest first. Default is largest (or newest) first. */
  readonly ascending?: boolean;
  /** Page size. Default 10. */
  readonly count?: number;
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly cursor?: string;
}

function seconds(time: InsightsTime): number {
  return Math.floor(time instanceof Date ? time.getTime() / 1000 : time);
}

/** The range as Unix seconds. The report is always asked for as a custom period. */
function rangeVariables(range: InsightsRange): Record<string, unknown> {
  const end = range.to !== undefined ? seconds(range.to) : Math.floor(Date.now() / 1000);
  const start =
    range.from !== undefined ? seconds(range.from) : end - DEFAULT_RANGE_DAYS * DAY_SECONDS;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new IgError('The insights range must start before it ends');
  }
  return { period: 'CUSTOM', startDate: start, endDate: end };
}

function firstMessage(json: Record<string, unknown>): string {
  const errors = json['errors'];
  const first = Array.isArray(errors) && isRecord(errors[0]) ? errors[0]['message'] : undefined;
  return typeof first === 'string' ? ': ' + first : '';
}

/**
 * Sends an insights query and returns its root with the key markers stripped. The query is
 * accepted for any account and answers an empty root when the account has no insights (it is
 * not professional, or the media is somebody else's), which is reported as an error.
 */
async function insightsRoot(
  client: PrivateClient,
  query: InsightsQuery,
  variables: Record<string, unknown>,
  what: string,
): Promise<Record<string, unknown>> {
  const json = await pandoRequest(client, {
    ...query,
    variables: { bloksVersioningId: client.session.profile.bloksVersioningId, ...variables },
  });
  const root = stripPandoMarkers(pandoRoot(json, query.rootField, what));
  if (!isRecord(root)) {
    throw new IgApiError(`No ${what} for this account${firstMessage(json)}`, 200, { raw: json });
  }
  return root;
}

function parseRoot<T>(
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: Error };
  },
  root: unknown,
  what: string,
): T {
  const parsed = schema.safeParse(root);
  if (!parsed.success) {
    throw new ClientSchemaError(`the ${what} did not match the schema`, root, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function getMediaInsights(
  client: PrivateClient,
  mediaId: string,
  query: InsightsQuery,
): Promise<MediaInsights> {
  const pk = checkedMediaId(mediaId).split('_')[0] ?? mediaId;
  const root = await insightsRoot(
    client,
    query,
    { mediaIgid: pk, translationsOverviewEnabled: false },
    'insights for this media',
  );
  return parseRoot(mediaInsightsSchema, root, 'insights');
}

/** Insights of one of the account's own posts: views, reach, interactions, where views came from. */
export function getPostInsights(client: PrivateClient, mediaId: string): Promise<MediaInsights> {
  return getMediaInsights(client, mediaId, POST);
}

/** Insights of one of the account's own reels: the post figures plus watch time and rates. */
export function getReelInsights(client: PrivateClient, mediaId: string): Promise<MediaInsights> {
  return getMediaInsights(client, mediaId, REEL);
}

/** The account overview for a date range: views, interactions, reach, profile visits. */
export async function getAccountInsights(
  client: PrivateClient,
  range: InsightsRange = {},
): Promise<AccountInsights> {
  const root = await insightsRoot(
    client,
    OVERVIEW,
    { redesignEnabled: false, ...rangeVariables(range) },
    'account insights',
  );
  return parseRoot(accountInsightsSchema, root, 'account insights');
}

/** The account's audience for a date range: followers, ages, places and active times. */
export async function getAudienceInsights(
  client: PrivateClient,
  range: InsightsRange = {},
): Promise<AudienceInsights> {
  const root = await insightsRoot(
    client,
    AUDIENCE,
    {
      redesignEnabled: true,
      useFollowerSnapshot: true,
      topLanguagesEnabled: true,
      ...rangeVariables(range),
    },
    'audience insights',
  );
  return parseRoot(audienceInsightsSchema, root, 'audience insights');
}

/** One page of the account's posts, reels or stories ranked by a figure. Pass `cursor` to continue. */
export async function getContentInsights(
  client: PrivateClient,
  options: ContentInsightsOptions = {},
): Promise<Page<ContentInsight>> {
  const root = await insightsRoot(
    client,
    CONTENT,
    {
      ...rangeVariables(options),
      metric: options.metric ?? 'views',
      includeCarouselMediaInsightsRendering: true,
      sortByCreationTime: options.sortByDate ?? false,
      sortDescending: !(options.ascending ?? false),
      count: options.count ?? DEFAULT_PAGE_SIZE,
      after: options.cursor ?? null,
      contentType: options.type ?? null,
    },
    'content insights',
  );
  const list = root['your_content'];
  if (!isRecord(list)) {
    throw new IgApiError('The account has no content insights for this range', 200, { raw: root });
  }
  const page = parseRoot(contentPageSchema, list, 'content insights');
  const next = page.page_info?.end_cursor;
  return page.page_info?.has_next_page === true && typeof next === 'string' && next !== ''
    ? { items: page.items, nextCursor: next }
    : { items: page.items };
}

/** Walks the whole content list, one item at a time across pages. */
export function paginateContentInsights(
  client: PrivateClient,
  options: Omit<ContentInsightsOptions, 'cursor'> = {},
): AsyncGenerator<ContentInsight> {
  return paginate((cursor) =>
    getContentInsights(client, cursor !== undefined ? { ...options, cursor } : options),
  );
}
