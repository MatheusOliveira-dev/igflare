import { describe, it, expect } from 'vitest';
import { getReelsTray, getUserStories, markStoriesSeen } from './story';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

function clientReturning(body: unknown): { client: PrivateClient; transport: FakeTransport } {
  const transport = new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  }));
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

describe('getReelsTray', () => {
  it('parses the tray into reels', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      tray: [
        { id: 1, user: { pk: 9, username: 'a' }, items: [{ pk: 3, media_type: 1 }] },
        { id: 2, user: { pk: 10, username: 'b' } },
      ],
    });

    const reels = await getReelsTray(client);

    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/feed/reels_tray/');
    expect(transport.requests[0]?.method).toBe('POST');
    expect(reels).toHaveLength(2);
    expect(reels[0]?.user?.username).toBe('a');
    expect(reels[0]?.items?.[0]?.pk).toBe('3');
  });

  it('throws when the tray is not an array', async () => {
    const { client } = clientReturning({ status: 'ok' });
    await expect(getReelsTray(client)).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('getUserStories', () => {
  it("returns a user's story media", async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      reel: { id: 5, items: [{ pk: 1, media_type: 2, code: 's' }] },
    });

    const items = await getUserStories(client, '9');

    expect(transport.requests[0]?.url).toContain('/api/v1/feed/user/9/story/');
    expect(items[0]?.code).toBe('s');
  });

  it('returns an empty array when the user has no active story', async () => {
    const { client } = clientReturning({ status: 'ok', reel: null });
    expect(await getUserStories(client, '9')).toEqual([]);
  });
});

describe('markStoriesSeen', () => {
  it('posts the viewing window of each story to the v2 seen endpoint', async () => {
    const { client, transport } = clientReturning({ status: 'ok' });

    await markStoriesSeen(client, ['4000000000000000003_10000000001']);

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v2/media/seen/');
    expect(request?.url).toContain('reel=1');
    expect(request?.url).toContain('live_vod=0');
    const form = new URLSearchParams(typeof request?.body === 'string' ? request.body : '');
    const signed = form.get('signed_body') ?? '';
    const body = JSON.parse(signed.slice(signed.indexOf('.') + 1)) as {
      reels: Record<string, string[]>;
    };
    const key = '4000000000000000003_10000000001_10000000001';
    expect(Object.keys(body.reels)).toEqual([key]);
    expect(body.reels[key]?.[0]).toMatch(/^\d{10}_\d{10}$/);
  });

  it('rejects an empty list and an id that is not pk_userid', async () => {
    const { client, transport } = clientReturning({ status: 'ok' });
    await expect(markStoriesSeen(client, [])).rejects.toBeInstanceOf(IgError);
    await expect(markStoriesSeen(client, ['123'])).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });
});
