import { describe, it, expect } from 'vitest';
import { searchUsers, searchHashtags, searchPlaces } from './search';
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

describe('search', () => {
  it('searches users and parses the ranked list', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      users: [{ pk: 1, username: 'alice' }],
    });

    const users = await searchUsers(client, 'ali');

    expect(transport.requests[0]?.url).toContain('/api/v1/users/search/?q=ali');
    expect(users[0]?.username).toBe('alice');
  });

  it('searches hashtags from the results array', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      results: [{ id: 17841563459123456, name: 'sunset', media_count: 42 }],
    });

    const tags = await searchHashtags(client, 'sun');

    expect(transport.requests[0]?.url).toContain('/api/v1/tags/search/?q=sun');
    expect(tags[0]?.name).toBe('sunset');
    expect(tags[0]?.media_count).toBe(42);
  });

  it('searches places and unwraps the location of each item', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      items: [
        { location: { pk: 7, name: 'Central Park', city: 'New York' } },
        { something_else: true },
      ],
    });

    const places = await searchPlaces(client, 'central');

    expect(transport.requests[0]?.url).toContain('/api/v1/fbsearch/places/?query=central');
    expect(places).toHaveLength(1);
    expect(places[0]?.name).toBe('Central Park');
  });

  it('throws a typed schema error when a result has the wrong shape', async () => {
    const { client } = clientReturning({ status: 'ok', users: [{ pk: 1, username: 42 }] });
    await expect(searchUsers(client, 'x')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('throws when the users array is missing', async () => {
    const { client } = clientReturning({ status: 'ok' });
    await expect(searchUsers(client, 'x')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});
