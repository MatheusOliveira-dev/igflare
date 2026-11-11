import { describe, it, expect } from 'vitest';
import { getHashtagSerpPage } from './hashtag-serp';
import { paginateHashtagFeed } from './feed';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError, IgApiError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const ROOT_KEY = '1$xdt_fbsearch__top_serp_graphql(request_data:{"query":$query})';

function media(pk: string, code: string): Record<string, unknown> {
  return {
    __typename: 'XDTMediaDict',
    pk,
    code,
    media_type: 1,
    user: { __typename: 'XDTUserDict', strong_id__: '10000000001', username: 'fake_user' },
  };
}

function gridUnit(...items: Record<string, unknown>[]): Record<string, unknown> {
  return { node: { __typename: 'XDTTopSerpMediaGridUnit', unit_type: 'MEDIA_GRID', items } };
}

const SYNTHETIC = { node: { __typename: 'XDTTopSerpSyntheticUnit', unit_type: 'SYNTHETIC' } };

function results(
  edges: unknown[],
  pageInfo: Record<string, unknown> = { has_next_page: false },
): HttpResponse {
  return {
    status: 200,
    headers: {},
    body: JSON.stringify({
      data: { [ROOT_KEY]: { edges, page_info: pageInfo } },
      extensions: { is_final: true },
    }),
  };
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

describe('getHashtagSerpPage', () => {
  it('sends the TopSerpQuery persisted query to graphql_www with the hashtag as the query', async () => {
    const { client, transport } = clientWith(() => results([gridUnit(media('1', 'a'))]));

    await getHashtagSerpPage(client, 'sunset');

    const request = transport.requests[0];
    expect(request?.url).toBe('https://i.instagram.com/graphql_www');
    expect(request?.method).toBe('POST');
    expect(request?.headers['X-FB-Friendly-Name']).toBe('TopSerpQuery');
    expect(request?.headers['X-Client-Doc-Id']).toBe('4185316819665014057952243780');
    expect(request?.headers['X-Root-Field-Name']).toBe('xdt_fbsearch__top_serp_graphql');
    const variables = variablesOf(request);
    expect(variables).toMatchObject({
      query: '#sunset',
      search_surface: 'TOP_SERP',
      search_type: 'SEARCH',
      requested_unit_types: ['MEDIA_GRID'],
      is_pagination_request: false,
      after: null,
      turn_id: 0,
      include_serp_grid_ad_fields: true,
      include_clips_viewer_fragment: false,
    });
    // Sending it, even empty, is refused by the server.
    expect(variables).not.toHaveProperty('last_seen_media_ids');
  });

  it('returns the media of the grid units and skips the other units', async () => {
    const { client } = clientWith(() =>
      results([
        SYNTHETIC,
        gridUnit(media('1', 'a'), media('2', 'b')),
        SYNTHETIC,
        gridUnit(media('3', 'c')),
      ]),
    );

    const page = await getHashtagSerpPage(client, 'sunset');

    expect(page.items.map((item) => item.code)).toEqual(['a', 'b', 'c']);
    expect(page.nextCursor).toBeUndefined();
  });

  it('gives the author the id the results keep under strong_id__', async () => {
    const { client } = clientWith(() => results([gridUnit(media('1', 'a'))]));
    const page = await getHashtagSerpPage(client, 'sunset');
    expect(page.items[0]?.user?.pk).toBe('10000000001');
    expect(page.items[0]?.user?.username).toBe('fake_user');
  });

  it('accepts the tag with a leading # and surrounding spaces', async () => {
    const { client, transport } = clientWith(() => results([]));
    await getHashtagSerpPage(client, '  #grêmio ');
    expect(variablesOf(transport.requests[0])['query']).toBe('#grêmio');
  });

  it('refuses an empty tag or one with spaces, before any request', async () => {
    const { client, transport } = clientWith(() => results([]));
    await expect(getHashtagSerpPage(client, '')).rejects.toBeInstanceOf(IgError);
    await expect(getHashtagSerpPage(client, '#')).rejects.toBeInstanceOf(IgError);
    await expect(getHashtagSerpPage(client, 'new year')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('continues from the cursor in the same search session', async () => {
    let call = 0;
    const { client, transport } = clientWith(() => {
      call += 1;
      return call === 1
        ? results([gridUnit(media('1', 'a'))], { has_next_page: true, end_cursor: 'CUR1' })
        : results([gridUnit(media('2', 'b'))]);
    });

    const first = await getHashtagSerpPage(client, 'sunset');
    expect(first.nextCursor).toBeTypeOf('string');
    const second = await getHashtagSerpPage(client, 'sunset', first.nextCursor);

    const one = variablesOf(transport.requests[0]);
    const two = variablesOf(transport.requests[1]);
    expect(two).toMatchObject({ is_pagination_request: true, after: 'CUR1', turn_id: 1 });
    for (const key of ['serp_session_id', 'search_session_id', 'journey_session_id']) {
      expect(two[key]).toBe(one[key]);
    }
    expect(second.items[0]?.code).toBe('b');
    expect(second.nextCursor).toBeUndefined();
  });

  it('starts every first page in a new search session', async () => {
    const { client, transport } = clientWith(() => results([]));
    await getHashtagSerpPage(client, 'a');
    await getHashtagSerpPage(client, 'a');
    expect(variablesOf(transport.requests[0])['search_session_id']).not.toBe(
      variablesOf(transport.requests[1])['search_session_id'],
    );
  });

  it('has no next cursor without a next page or without an end cursor', async () => {
    const lastPage = clientWith(() => results([], { has_next_page: false, end_cursor: 'X' }));
    expect((await getHashtagSerpPage(lastPage.client, 'a')).nextCursor).toBeUndefined();
    const noCursor = clientWith(() => results([], { has_next_page: true }));
    expect((await getHashtagSerpPage(noCursor.client, 'a')).nextCursor).toBeUndefined();
  });

  it('rejects a cursor that did not come from a hashtag page, before any request', async () => {
    const { client, transport } = clientWith(() => results([]));
    await expect(getHashtagSerpPage(client, 'a', 'not-a-cursor')).rejects.toBeInstanceOf(IgError);
    const wrongShape = Buffer.from(JSON.stringify({ after: 1 })).toString('base64url');
    await expect(getHashtagSerpPage(client, 'a', wrongShape)).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws a typed error carrying the server message when the query is refused', async () => {
    const { client } = clientWith(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ data: null, errors: [{ message: 'noncoercible_variable_value' }] }),
    }));
    const error = await getHashtagSerpPage(client, 'a').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IgApiError);
    expect((error as IgApiError).message).toContain('noncoercible_variable_value');
  });

  it('throws when the results have no edges list', async () => {
    const { client } = clientWith(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ data: { [ROOT_KEY]: { page_info: {} } } }),
    }));
    await expect(getHashtagSerpPage(client, 'a')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('throws when a result media does not match the schema', async () => {
    const { client } = clientWith(() =>
      results([gridUnit({ __typename: 'XDTMediaDict', pk: '1', media_type: 'photo' })]),
    );
    await expect(getHashtagSerpPage(client, 'a')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('paginateHashtagFeed', () => {
  it('walks every page of a hashtag', async () => {
    let call = 0;
    const { client } = clientWith(() => {
      call += 1;
      return call === 1
        ? results([gridUnit(media('1', 'a'))], { has_next_page: true, end_cursor: 'C' })
        : results([gridUnit(media('2', 'b'))]);
    });

    const ids: (string | undefined)[] = [];
    for await (const item of paginateHashtagFeed(client, 'x')) {
      ids.push(item.pk);
    }
    expect(ids).toEqual(['1', '2']);
  });
});
