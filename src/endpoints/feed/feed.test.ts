import { describe, it, expect } from 'vitest';
import { getUserFeed, paginateUserFeed, getTimelineFeed, paginateTimeline } from './feed';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';

/** Recovers the JSON payload from a signed_body form request. */
function signedPayload(body: string | undefined): Record<string, unknown> {
  const form = new URLSearchParams(body ?? '');
  const signed = form.get('signed_body') ?? '';
  return JSON.parse(signed.slice(signed.indexOf('.') + 1)) as Record<string, unknown>;
}

function clientReturning(body: unknown): { client: PrivateClient; transport: FakeTransport } {
  const transport = new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  }));
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

describe('getUserFeed', () => {
  it('fetches the first page with no max_id and parses media items', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      items: [{ pk: 1, code: 'abc', media_type: 1, user: { pk: 9, username: 'a' } }],
      next_max_id: 'n1',
    });

    const page = await getUserFeed(client, '42');

    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/feed/user/42/');
    expect(transport.requests[0]?.method).toBe('GET');
    expect(page.items[0]?.pk).toBe('1');
    expect(page.items[0]?.user?.username).toBe('a');
    expect(page.nextCursor).toBe('n1');
  });

  it('passes the cursor as max_id and omits nextCursor on the last page', async () => {
    const { client, transport } = clientReturning({ status: 'ok', items: [{ pk: 2 }] });

    const page = await getUserFeed(client, '42', { maxId: 'n1' });

    expect(transport.requests[0]?.url).toContain('/api/v1/feed/user/42/?max_id=n1');
    expect(page.nextCursor).toBeUndefined();
  });

  it('walks every post across pages with the iterator', async () => {
    let call = 0;
    const transport = new FakeTransport(() => {
      call += 1;
      const body =
        call === 1
          ? { status: 'ok', items: [{ pk: 1 }], next_max_id: 'p2' }
          : { status: 'ok', items: [{ pk: 2 }] };
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    });
    const client = new PrivateClient({ transport, session: createSession() });

    const ids: (string | undefined)[] = [];
    for await (const media of paginateUserFeed(client, '42')) {
      ids.push(media.pk);
    }

    expect(ids).toEqual(['1', '2']);
    expect(call).toBe(2);
  });

  it('throws a typed schema error when a media item has the wrong shape', async () => {
    const { client } = clientReturning({ status: 'ok', items: [{ pk: 1, like_count: 'many' }] });
    await expect(getUserFeed(client, '42')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('throws when the response has no items array', async () => {
    const { client } = clientReturning({ status: 'ok' });
    await expect(getUserFeed(client, '42')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('getTimelineFeed', () => {
  it('reads the feed_items envelope, skipping non-media entries', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      feed_items: [
        { media_or_ad: { pk: 1, code: 'a' } },
        { suggested_users: { type: 1 } },
        { end_of_feed_demarcator: {} },
      ],
      next_max_id: 'n1',
      more_available: true,
    });

    const page = await getTimelineFeed(client);

    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/feed/timeline/');
    expect(transport.requests[0]?.method).toBe('POST');
    expect(signedPayload(transport.requests[0]?.body)['reason']).toBe('cold_start_fetch');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.code).toBe('a');
    expect(page.nextCursor).toBe('n1');
  });

  it('reads the flat items envelope and sends pagination reason with max_id', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      items: [{ pk: 2 }],
      next_max_id: 'n2',
      more_available: true,
    });

    const page = await getTimelineFeed(client, { maxId: 'n1' });

    const payload = signedPayload(transport.requests[0]?.body);
    expect(payload['reason']).toBe('pagination');
    expect(payload['max_id']).toBe('n1');
    expect(page.items[0]?.pk).toBe('2');
    expect(page.nextCursor).toBe('n2');
  });

  it('omits nextCursor when more_available is false', async () => {
    const { client } = clientReturning({
      status: 'ok',
      items: [{ pk: 3 }],
      next_max_id: 'n3',
      more_available: false,
    });
    const page = await getTimelineFeed(client);
    expect(page.nextCursor).toBeUndefined();
  });

  it('throws when the response has neither feed_items nor items', async () => {
    const { client } = clientReturning({ status: 'ok', num_results: 0 });
    await expect(getTimelineFeed(client)).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('walks the timeline across pages with the iterator', async () => {
    let call = 0;
    const transport = new FakeTransport(() => {
      call += 1;
      const body =
        call === 1
          ? { status: 'ok', items: [{ pk: 1 }], next_max_id: 'p2', more_available: true }
          : { status: 'ok', items: [{ pk: 2 }], more_available: false };
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    });
    const client = new PrivateClient({ transport, session: createSession() });

    const ids: (string | undefined)[] = [];
    for await (const media of paginateTimeline(client)) {
      ids.push(media.pk);
    }
    expect(ids).toEqual(['1', '2']);
  });
});
