import { describe, it, expect } from 'vitest';
import { getPostInsights, getReelInsights } from './insights';
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
