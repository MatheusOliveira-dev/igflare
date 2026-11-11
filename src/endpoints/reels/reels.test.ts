import { describe, it, expect } from 'vitest';
import {
  getExploreReels,
  getFriendsReels,
  getReelsFeed,
  getUserReels,
  paginateExploreReels,
  paginateReelsFeed,
  paginateUserReels,
} from './reels';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

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

function signed(request: HttpRequest | undefined): Record<string, unknown> {
  const form = new URLSearchParams(typeof request?.body === 'string' ? request.body : '');
  const value = form.get('signed_body') ?? '';
  return JSON.parse(value.slice(value.indexOf('.') + 1)) as Record<string, unknown>;
}

const reel = (pk: string, code: string): unknown => ({ media: { pk, code, media_type: 2 } });

describe('getUserReels', () => {
  it('reads one page of a user reels', async () => {
    const { client, transport } = clientWith(() =>
      json({
        status: 'ok',
        items: [reel('1', 'a'), reel('2', 'b')],
        paging_info: { max_id: 'm2', more_available: true },
      }),
    );

    const page = await getUserReels(client, '10000000001');

    const request = transport.requests[0];
    expect(request?.url).toBe('https://i.instagram.com/api/v1/clips/user/');
    expect(request?.method).toBe('POST');
    expect(signed(request)).toMatchObject({
      target_user_id: '10000000001',
      max_id: '',
      page_size: '12',
      include_feed_video: 'true',
    });
    expect(page.items.map((item) => item.code)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('m2');
  });

  it('sends the cursor and keeps the page size within what the app allows', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', items: [] }));
    await getUserReels(client, '5', { cursor: 'm2', pageSize: 500 });
    await getUserReels(client, '5', { pageSize: 0 });
    expect(signed(transport.requests[0])).toMatchObject({ max_id: 'm2', page_size: '50' });
    expect(signed(transport.requests[1])['page_size']).toBe('1');
  });

  it('has no next cursor on the last page, or when the server gives none', async () => {
    const last = clientWith(() =>
      json({ status: 'ok', items: [], paging_info: { max_id: 'x', more_available: false } }),
    );
    expect((await getUserReels(last.client, '5')).nextCursor).toBeUndefined();
    const noCursor = clientWith(() =>
      json({ status: 'ok', items: [], paging_info: { more_available: true } }),
    );
    expect((await getUserReels(noCursor.client, '5')).nextCursor).toBeUndefined();
  });

  it('refuses a user id that is not numeric, before any request', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', items: [] }));
    await expect(getUserReels(client, '1/../x')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('skips entries that carry no media', async () => {
    const { client } = clientWith(() =>
      json({ status: 'ok', items: [reel('1', 'a'), { ad: {} }, { media: null }] }),
    );
    expect((await getUserReels(client, '5')).items).toHaveLength(1);
  });

  it('throws when the answer has no list, or a reel does not match the schema', async () => {
    const empty = clientWith(() => json({ status: 'ok' }));
    await expect(getUserReels(empty.client, '5')).rejects.toBeInstanceOf(ClientSchemaError);
    const bad = clientWith(() =>
      json({ status: 'ok', items: [{ media: { pk: '1', media_type: 'video' } }] }),
    );
    await expect(getUserReels(bad.client, '5')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('walks every page with the iterator', async () => {
    let call = 0;
    const { client } = clientWith(() => {
      call += 1;
      return call === 1
        ? json({
            status: 'ok',
            items: [reel('1', 'a')],
            paging_info: { max_id: 'n', more_available: true },
          })
        : json({ status: 'ok', items: [reel('2', 'b')], paging_info: { more_available: false } });
    });
    const codes: (string | undefined)[] = [];
    for await (const media of paginateUserReels(client, '5')) codes.push(media.code);
    expect(codes).toEqual(['a', 'b']);
  });
});

describe('the reels feeds', () => {
  it('reads the explore reels from both lists and leaves out entries with no media', async () => {
    const { client, transport } = clientWith(() =>
      json({
        status: 'ok',
        items: [],
        items_with_ads: [reel('1', 'a'), { ad: { id: 'x' } }, reel('2', 'b')],
        paging_info: { max_id: 'e2', more_available: true },
      }),
    );

    const page = await getExploreReels(client, { cursor: 'e1' });

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v1/clips/discover/');
    expect(request?.url).toContain('max_id=e1');
    expect(request?.method).toBe('POST');
    expect(page.items.map((item) => item.code)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('e2');
  });

  it('reads the Reels tab feed and the friends reels from their own endpoints', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', items: [reel('1', 'a')] }));
    expect((await getReelsFeed(client)).items).toHaveLength(1);
    expect((await getFriendsReels(client)).items).toHaveLength(1);
    expect(transport.requests[0]?.url).toContain('/api/v1/clips/connected/');
    expect(transport.requests[1]?.url).toContain('/api/v1/clips/discover/social/');
  });

  it('walks the Reels tab feed and the explore reels across pages', async () => {
    const pages = (): (() => HttpResponse) => {
      let call = 0;
      return () => {
        call += 1;
        return call === 1
          ? json({
              status: 'ok',
              items: [reel('1', 'a')],
              paging_info: { max_id: 'n', more_available: true },
            })
          : json({ status: 'ok', items: [reel('2', 'b')], paging_info: { more_available: false } });
      };
    };
    const feed = clientWith(pages());
    const explore = clientWith(pages());
    const a: (string | undefined)[] = [];
    const b: (string | undefined)[] = [];
    for await (const media of paginateReelsFeed(feed.client)) a.push(media.code);
    for await (const media of paginateExploreReels(explore.client)) b.push(media.code);
    expect(a).toEqual(['a', 'b']);
    expect(b).toEqual(['a', 'b']);
  });
});
