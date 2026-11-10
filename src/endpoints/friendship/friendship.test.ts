import { describe, it, expect } from 'vitest';
import { followUser, unfollowUser, getFriendshipStatus } from './friendship';
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

describe('friendship actions', () => {
  it('follows a user and returns the friendship status', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      friendship_status: { following: true, outgoing_request: false, followed_by: false },
    });

    const status = await followUser(client, '42');

    expect(transport.requests[0]?.url).toBe(
      'https://i.instagram.com/api/v1/friendships/create/42/',
    );
    expect(transport.requests[0]?.method).toBe('POST');
    expect(status.following).toBe(true);
  });

  it('unfollows a user against the destroy endpoint', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      friendship_status: { following: false },
    });

    const status = await unfollowUser(client, '42');

    expect(transport.requests[0]?.url).toBe(
      'https://i.instagram.com/api/v1/friendships/destroy/42/',
    );
    expect(status.following).toBe(false);
  });

  it('reads the friendship status from the top-level show response', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      following: true,
      followed_by: true,
      is_private: false,
    });

    const status = await getFriendshipStatus(client, '42');

    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/friendships/show/42/');
    expect(transport.requests[0]?.method).toBe('GET');
    expect(status.following).toBe(true);
    expect(status.followed_by).toBe(true);
  });

  it('throws a typed schema error when friendship_status has the wrong shape', async () => {
    const { client } = clientReturning({ status: 'ok', friendship_status: { following: 'yes' } });

    const error = await followUser(client, '42').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ClientSchemaError);
  });
});
