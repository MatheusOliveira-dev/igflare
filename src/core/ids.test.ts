import { describe, it, expect } from 'vitest';
import { checkedId, checkedMediaId } from './ids';
import { PrivateClient } from './http/private-client';
import { FakeTransport } from './transport/adapters/fake';
import { createSession } from './session/session';
import { IgError } from '../errors/ig-error';
import { getUserInfo, getUserInfoByUsername } from '../endpoints/user/user-info';
import {
  followUser,
  unfollowUser,
  getFriendshipStatus,
  approveRequest,
  denyRequest,
  blockUser,
  unblockUser,
  removeFollower,
} from '../endpoints/friendship/friendship';
import { getUserFeed, getLocationFeed } from '../endpoints/feed/feed';
import { getUserStories } from '../endpoints/story/story';
import {
  getMediaInfo,
  likeMedia,
  unlikeMedia,
  deleteMedia,
  saveMedia,
  unsaveMedia,
  getLikers,
  getComments,
  commentMedia,
  deleteComment,
} from '../endpoints/media/media';

const FORGED = '1/../../accounts/logout';

describe('checkedId', () => {
  it('passes digits and rejects anything that could rewrite a path', () => {
    expect(checkedId('10000000001')).toBe('10000000001');
    for (const bad of ['', 'a', '1/2', '1?x=1', '../x', '1 2', '-1', '1.5', FORGED]) {
      expect(() => checkedId(bad)).toThrow(IgError);
    }
  });

  it('accepts a media id with or without the author', () => {
    expect(checkedMediaId('123')).toBe('123');
    expect(checkedMediaId('123_456')).toBe('123_456');
    for (const bad of ['123_', '_1', '1_2_3', 'a_1', FORGED]) {
      expect(() => checkedMediaId(bad)).toThrow(IgError);
    }
  });
});

describe('a forged id never reaches the network', () => {
  const cases: [string, (c: PrivateClient) => Promise<unknown>][] = [
    ['getUserInfo', (c) => getUserInfo(c, FORGED)],
    ['followUser', (c) => followUser(c, FORGED)],
    ['unfollowUser', (c) => unfollowUser(c, FORGED)],
    ['getFriendshipStatus', (c) => getFriendshipStatus(c, FORGED)],
    ['approveRequest', (c) => approveRequest(c, FORGED)],
    ['denyRequest', (c) => denyRequest(c, FORGED)],
    ['blockUser', (c) => blockUser(c, FORGED)],
    ['unblockUser', (c) => unblockUser(c, FORGED)],
    ['removeFollower', (c) => removeFollower(c, FORGED)],
    ['getUserFeed', (c) => getUserFeed(c, FORGED)],
    ['getLocationFeed', (c) => getLocationFeed(c, FORGED)],
    ['getUserStories', (c) => getUserStories(c, FORGED)],
    ['getMediaInfo', (c) => getMediaInfo(c, FORGED)],
    ['likeMedia', (c) => likeMedia(c, FORGED)],
    ['unlikeMedia', (c) => unlikeMedia(c, FORGED)],
    ['deleteMedia', (c) => deleteMedia(c, FORGED)],
    ['saveMedia', (c) => saveMedia(c, FORGED)],
    ['unsaveMedia', (c) => unsaveMedia(c, FORGED)],
    ['getLikers', (c) => getLikers(c, FORGED)],
    ['getComments', (c) => getComments(c, FORGED)],
    ['commentMedia', (c) => commentMedia(c, FORGED, 'x')],
    ['deleteComment media', (c) => deleteComment(c, FORGED, '1')],
    ['deleteComment comment', (c) => deleteComment(c, '1', FORGED)],
  ];

  it.each(cases)('%s', async (_name, call) => {
    const transport = new FakeTransport(() => ({ status: 200, headers: {}, body: '{}' }));
    const client = new PrivateClient({ transport, session: createSession() });
    await expect(call(client)).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('encodes a username instead of letting it add path segments', async () => {
    const transport = new FakeTransport(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ status: 'ok', user: { pk: 1, username: 'x' } }),
    }));
    const client = new PrivateClient({ transport, session: createSession() });
    await getUserInfoByUsername(client, 'a/../b?c');
    expect(transport.requests[0]?.url).toContain('/users/a%2F..%2Fb%3Fc/usernameinfo/');
  });
});
