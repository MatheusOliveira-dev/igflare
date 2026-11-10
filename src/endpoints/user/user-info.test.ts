import { describe, it, expect } from 'vitest';
import { getUserInfo } from './user-info';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { IgError } from '../../errors/ig-error';
import { ClientSchemaError } from '../../errors/api-errors';

function respondWith(body: unknown): PrivateClient {
  const transport = new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  }));
  return new PrivateClient({ transport, session: createSession() });
}

describe('getUserInfo', () => {
  it('requests the user info endpoint with the pk in the path', async () => {
    const transport = new FakeTransport(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ status: 'ok', user: { pk: 999, username: 'u' } }),
    }));
    const client = new PrivateClient({ transport, session: createSession() });

    await getUserInfo(client, '999');

    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/users/999/info/');
    expect(transport.requests[0]?.method).toBe('GET');
  });

  it('returns the validated user model with pk normalized to a string', async () => {
    const client = respondWith({
      status: 'ok',
      user: {
        pk: 123,
        username: 'alice',
        full_name: 'Alice',
        is_private: false,
        is_verified: true,
        profile_pic_url: 'https://cdn/x.jpg',
        follower_count: 10,
        following_count: 5,
        media_count: 2,
        biography: 'hi',
      },
    });

    const user = await getUserInfo(client, '123');

    expect(user.pk).toBe('123');
    expect(user.username).toBe('alice');
    expect(user.is_verified).toBe(true);
    expect(user.follower_count).toBe(10);
  });

  it('keeps unexposed fields via passthrough and tolerates null counts', async () => {
    const client = respondWith({
      status: 'ok',
      user: { pk: '7', username: 'bob', follower_count: null, latest_reel_media: 42 },
    });

    const user = await getUserInfo(client, '7');

    expect(user.follower_count).toBeNull();
    expect((user as Record<string, unknown>)['latest_reel_media']).toBe(42);
  });

  it('throws when the response carries no user', async () => {
    const client = respondWith({ status: 'ok' });
    await expect(getUserInfo(client, '1')).rejects.toBeInstanceOf(IgError);
  });

  it('throws a typed schema error carrying the raw body on a shape mismatch', async () => {
    const client = respondWith({ status: 'ok', user: { pk: 1, follower_count: 'lots' } });

    const error = await getUserInfo(client, '1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ClientSchemaError);
    expect((error as ClientSchemaError).raw).toMatchObject({ follower_count: 'lots' });
  });
});
