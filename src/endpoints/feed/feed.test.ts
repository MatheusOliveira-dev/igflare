import { describe, it, expect } from 'vitest';
import { getUserFeed, paginateUserFeed } from './feed';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';

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
    expect(page.nextMaxId).toBe('n1');
  });

  it('passes the cursor as max_id and omits nextMaxId on the last page', async () => {
    const { client, transport } = clientReturning({ status: 'ok', items: [{ pk: 2 }] });

    const page = await getUserFeed(client, '42', { maxId: 'n1' });

    expect(transport.requests[0]?.url).toContain('/api/v1/feed/user/42/?max_id=n1');
    expect(page.nextMaxId).toBeUndefined();
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
