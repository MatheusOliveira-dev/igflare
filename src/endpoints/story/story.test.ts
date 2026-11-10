import { describe, it, expect } from 'vitest';
import { getReelsTray, getUserStories } from './story';
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
