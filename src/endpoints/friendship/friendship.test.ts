import { describe, it, expect } from 'vitest';
import {
  followUser,
  unfollowUser,
  getFriendshipStatus,
  getFollowers,
  getFollowing,
  paginateFollowers,
} from './friendship';
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

describe('friendship lists', () => {
  it('fetches a followers page with a rank_token and no max_id on the first page', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      users: [{ pk: 1, username: 'a' }],
      next_max_id: '100',
    });

    const page = await getFollowers(client, '42');

    const url = transport.requests[0]?.url ?? '';
    expect(url.startsWith('https://i.instagram.com/api/v1/friendships/42/followers/?')).toBe(true);
    expect(url).toContain('rank_token=');
    expect(url).not.toContain('max_id=');
    expect(page.items[0]?.username).toBe('a');
    expect(page.nextCursor).toBe('100');
  });

  it('passes the cursor as max_id and omits nextCursor on the last page', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      users: [{ pk: 2, username: 'b' }],
    });

    const page = await getFollowing(client, '42', { maxId: '100' });

    expect(transport.requests[0]?.url).toContain('/friendships/42/following/?');
    expect(transport.requests[0]?.url).toContain('max_id=100');
    expect(page.nextCursor).toBeUndefined();
  });

  it('walks every follower across pages with the iterator', async () => {
    let call = 0;
    const transport = new FakeTransport(() => {
      call += 1;
      const body =
        call === 1
          ? { status: 'ok', users: [{ pk: 1, username: 'a' }], next_max_id: 'p2' }
          : { status: 'ok', users: [{ pk: 2, username: 'b' }] };
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    });
    const client = new PrivateClient({ transport, session: createSession() });

    const names: string[] = [];
    for await (const user of paginateFollowers(client, '42')) {
      names.push(user.username ?? '');
    }

    expect(names).toEqual(['a', 'b']);
    expect(call).toBe(2);
  });

  it('throws a typed schema error when a list item has the wrong shape', async () => {
    const { client } = clientReturning({
      status: 'ok',
      users: [{ pk: 1, follower_count: 'lots' }],
    });

    const error = await getFollowers(client, '42').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ClientSchemaError);
  });
});
