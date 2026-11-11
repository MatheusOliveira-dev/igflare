import { describe, it, expect } from 'vitest';
import {
  getAccountInsights,
  getAudienceInsights,
  getContentInsights,
  getPostInsights,
  getReelInsights,
  paginateContentInsights,
} from './insights';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError, IgApiError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const POST_KEY = '1$ig_post_insights(bloks_versioning_id:$bloksVersioningId,media_igid:$mediaIgid)';
const REEL_KEY = '1$ig_reel_insights(bloks_versioning_id:$bloksVersioningId,media_igid:$mediaIgid)';

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function clientWith(handler: (req: HttpRequest) => HttpResponse): {
  client: PrivateClient;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(handler);
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

function variablesOf(request: HttpRequest | undefined): Record<string, unknown> {
  const body = typeof request?.body === 'string' ? request.body : '';
  return JSON.parse(new URLSearchParams(body).get('variables') ?? '{}') as Record<string, unknown>;
}

const metric = (id: string, value: number | null, text: string): Record<string, unknown> => ({
  id,
  label: id,
  '1fvalue': value,
  format: 'COUNT',
  formatted_value: text,
});

const POST_BODY = {
  media_id: '4000000000000000001',
  likes: 2,
  comments: 0,
  total_views: 3,
  follows: 0,
  profile_visits: null,
  viewers_or_reach: metric('viewers', 1, '1'),
  views_sources: [metric('feed', 0.333, '33.3%')],
  demographics: { status: 'INSUFFICIENT_DATA', age_breakdown: [] },
};

describe('getPostInsights', () => {
  it('asks for the post by its pk and reads the figures', async () => {
    const { client, transport } = clientWith(() => json({ data: { [POST_KEY]: POST_BODY } }));

    const insights = await getPostInsights(client, '10000000001_20000000002');

    const request = transport.requests[0];
    expect(request?.url).toBe('https://i.instagram.com/graphql_www');
    expect(request?.headers['X-FB-Friendly-Name']).toBe('PostInsightsQuery');
    expect(request?.headers['X-Root-Field-Name']).toBe('ig_post_insights');
    expect(variablesOf(request)).toMatchObject({
      mediaIgid: '10000000001',
      translationsOverviewEnabled: false,
    });
    expect(insights.likes).toBe(2);
    expect(insights.total_views).toBe(3);
    expect(insights.viewers_or_reach).toMatchObject({
      id: 'viewers',
      value: 1,
      formatted_value: '1',
    });
    expect(insights.views_sources?.[0]).toMatchObject({ id: 'feed', value: 0.333 });
    expect(insights.demographics?.status).toBe('INSUFFICIENT_DATA');
  });

  it('reads an answer the server streamed in pieces', async () => {
    const first = JSON.stringify({ data: { [POST_KEY]: { media_id: '1', likes: 1 } } });
    const later = JSON.stringify({
      path: ['ig_post_insights(bloks_versioning_id:$bloksVersioningId,media_igid:$mediaIgid)'],
      data: { total_views: 9 },
    });
    const { client } = clientWith(() => ({
      status: 200,
      headers: {},
      body: `${first}\n        ${later}\n`,
    }));
    expect(await getPostInsights(client, '1')).toMatchObject({ likes: 1, total_views: 9 });
  });

  it('rejects an id that is not a media id before sending anything', async () => {
    const { client, transport } = clientWith(() => json({}));
    await expect(getPostInsights(client, '../x')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when the account has no insights for the media', async () => {
    const empty = clientWith(() =>
      json({ data: { [POST_KEY]: null }, errors: [{ message: 'field_exception' }] }),
    );
    await expect(getPostInsights(empty.client, '1')).rejects.toThrow('field_exception');
    const bare = clientWith(() => json({ data: { [POST_KEY]: null } }));
    await expect(getPostInsights(bare.client, '1')).rejects.toBeInstanceOf(IgApiError);
  });

  it('throws when the query is refused outright', async () => {
    const { client } = clientWith(() => json({ errors: [{ message: 'bad variable' }] }));
    await expect(getPostInsights(client, '1')).rejects.toThrow('bad variable');
  });

  it('throws when the figures do not match the schema', async () => {
    const { client } = clientWith(() => json({ data: { [POST_KEY]: { likes: 'many' } } }));
    await expect(getPostInsights(client, '1')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('getReelInsights', () => {
  it('uses the reel query and reads the watch figures', async () => {
    const { client, transport } = clientWith(() =>
      json({
        data: {
          [REEL_KEY]: {
            ...POST_BODY,
            avg_watch_time: { id: 'avg_watch_time', label: 'Average watch time', '1fvalue': null },
            performance_factors: [metric('likes_rate', 0, '0.0%')],
          },
        },
      }),
    );

    const insights = await getReelInsights(client, '1');

    expect(transport.requests[0]?.headers['X-FB-Friendly-Name']).toBe('ReelInsightsQuery');
    expect(insights.avg_watch_time?.value).toBeNull();
    expect(insights.performance_factors?.[0]).toMatchObject({ id: 'likes_rate', value: 0 });
  });
});

const ACCOUNT_KEY =
  '1$ig_account_insights(bloks_versioning_id:$bloksVersioningId,end_date:$endDate,period:$period,start_date:$startDate)';
const account = (body: unknown): HttpResponse => json({ data: { [ACCOUNT_KEY]: body } });

describe('getAccountInsights', () => {
  it('asks for a custom range, 30 days back from now by default, and reads the figures', async () => {
    const { client, transport } = clientWith(() =>
      account({
        account_views_count: { total: metric('views_count', 9, '9') },
        interactions_count: {
          total: metric('interactions_count', 4, '4'),
          follower: { '1fvalue': 0 },
        },
        profile_visits: { '1fvalue': 15 },
        account_views_by_content_type: {
          '1ftotal': 9,
          entries: [{ content_type: 'post', '1ftotal': 6, '1ffollower_count': 6 }],
        },
      }),
    );

    const before = Math.floor(Date.now() / 1000);
    const insights = await getAccountInsights(client);

    const request = transport.requests[0];
    expect(request?.headers['X-FB-Friendly-Name']).toBe('AccountInsightsOverviewQuery');
    expect(request?.headers['X-Root-Field-Name']).toBe('ig_account_insights');
    const variables = variablesOf(request);
    expect(variables).toMatchObject({ period: 'CUSTOM', redesignEnabled: false });
    expect(Number(variables['endDate'])).toBeGreaterThanOrEqual(before);
    expect(Number(variables['endDate']) - Number(variables['startDate'])).toBe(30 * 86400);
    expect(insights.account_views_count?.total).toMatchObject({ value: 9, formatted_value: '9' });
    expect(insights.interactions_count?.follower?.value).toBe(0);
    expect(insights.profile_visits?.value).toBe(15);
    expect(insights.account_views_by_content_type?.entries?.[0]).toMatchObject({
      content_type: 'post',
      total: 6,
      follower_count: 6,
    });
  });

  it('takes the range as dates or as Unix seconds', async () => {
    const { client, transport } = clientWith(() => account({}));
    await getAccountInsights(client, { from: new Date(1_700_000_000_500), to: 1_700_086_400 });
    expect(variablesOf(transport.requests[0])).toMatchObject({
      startDate: 1_700_000_000,
      endDate: 1_700_086_400,
    });
  });

  it('refuses a range that ends before it starts', async () => {
    const { client, transport } = clientWith(() => account({}));
    await expect(getAccountInsights(client, { from: 20, to: 10 })).rejects.toBeInstanceOf(IgError);
    await expect(getAccountInsights(client, { from: NaN })).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when the account has no insights', async () => {
    const { client } = clientWith(() =>
      json({ data: { [ACCOUNT_KEY]: null }, errors: [{ message: 'field_exception' }] }),
    );
    await expect(getAccountInsights(client)).rejects.toThrow('field_exception');
  });
});

describe('getAudienceInsights', () => {
  it('reads followers, ages, places and the active times of the nested field', async () => {
    const { client, transport } = clientWith(() =>
      account({
        follower_count: metric('follower_count', 2, '2'),
        age_demographics: {
          entries: [{ age_range: '18-24', '1fpercentage': 50, '1fmen_percentage': 25 }],
        },
        top_countries: [{ id: 'BR', name: 'Brazil', '1fpercentage': 100, display_value: '100%' }],
        '1$active_times(timezone:$timezone)': { slots: [{ day: 0, hour: 3, '1fvalue': 7 }] },
      }),
    );

    const audience = await getAudienceInsights(client, { from: 1, to: 2 });

    expect(transport.requests[0]?.headers['X-FB-Friendly-Name']).toBe(
      'AccountInsightsAudienceQuery',
    );
    expect(variablesOf(transport.requests[0])).toMatchObject({
      startDate: 1,
      endDate: 2,
      topLanguagesEnabled: true,
    });
    expect(audience.follower_count?.value).toBe(2);
    expect(audience.age_demographics?.entries?.[0]).toMatchObject({
      age_range: '18-24',
      percentage: 50,
    });
    expect(audience.top_countries?.[0]).toMatchObject({ name: 'Brazil', percentage: 100 });
    expect(audience.active_times?.slots?.[0]).toMatchObject({ day: 0, hour: 3, value: 7 });
  });

  it('throws when the answer does not match the schema', async () => {
    const { client } = clientWith(() => account({ top_countries: 'many' }));
    await expect(getAudienceInsights(client)).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

const CONTENT_FIELD = '1$your_content(after:$after,content_type:$contentType,count:$count)';
const contentItem = (id: string): unknown => ({
  thumbnail: { media_id: id, media_type: 'post', creation_time: 1_700_000_000 },
  metrics: [{ metric: 'views', '1fvalue': 3 }],
});

describe('getContentInsights', () => {
  it('asks for one kind of content ranked by a figure and reads the items', async () => {
    const { client, transport } = clientWith(() =>
      account({
        [CONTENT_FIELD]: {
          items: [contentItem('10000000001')],
          page_info: { has_next_page: true, end_cursor: 'c1' },
        },
      }),
    );

    const page = await getContentInsights(client, {
      type: 'reels',
      metric: 'likes',
      sortByDate: true,
      ascending: true,
      count: 5,
    });

    expect(transport.requests[0]?.headers['X-FB-Friendly-Name']).toBe(
      'AccountInsightsContentQuery',
    );
    expect(variablesOf(transport.requests[0])).toMatchObject({
      contentType: 'reels',
      metric: 'likes',
      sortByCreationTime: true,
      sortDescending: false,
      count: 5,
      after: null,
    });
    expect(page.items[0]?.thumbnail.media_id).toBe('10000000001');
    expect(page.items[0]?.metrics?.[0]).toMatchObject({ metric: 'views', value: 3 });
    expect(page.nextCursor).toBe('c1');
  });

  it('defaults to all content by views, and sends the cursor', async () => {
    const { client, transport } = clientWith(() => account({ [CONTENT_FIELD]: { items: [] } }));
    const page = await getContentInsights(client, { cursor: 'c9' });
    expect(variablesOf(transport.requests[0])).toMatchObject({
      contentType: null,
      metric: 'views',
      sortDescending: true,
      count: 10,
      after: 'c9',
    });
    expect(page.nextCursor).toBeUndefined();
  });

  it('has no next cursor on the last page', async () => {
    const { client } = clientWith(() =>
      account({
        [CONTENT_FIELD]: { items: [], page_info: { has_next_page: false, end_cursor: 'x' } },
      }),
    );
    expect((await getContentInsights(client)).nextCursor).toBeUndefined();
  });

  it('throws when the list is missing', async () => {
    const { client } = clientWith(() => account({ content_tip: null }));
    await expect(getContentInsights(client)).rejects.toBeInstanceOf(IgApiError);
  });

  it('walks every page with the iterator', async () => {
    let call = 0;
    const { client } = clientWith(() => {
      call += 1;
      return call === 1
        ? account({
            [CONTENT_FIELD]: {
              items: [contentItem('1')],
              page_info: { has_next_page: true, end_cursor: 'n' },
            },
          })
        : account({ [CONTENT_FIELD]: { items: [contentItem('2')] } });
    });
    const ids: string[] = [];
    for await (const item of paginateContentInsights(client, { type: 'posts' })) {
      ids.push(item.thumbnail.media_id);
    }
    expect(ids).toEqual(['1', '2']);
  });
});
