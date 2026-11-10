import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { IgClient } from './ig-client';
import { FakeTransport } from '../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../core/transport/http-transport';
import { MemorySessionStore } from '../core/session/adapters/memory';
import { createSession } from '../core/session/session';

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function clientWith(handler: (req: HttpRequest) => HttpResponse): {
  ig: IgClient;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(handler);
  return { ig: new IgClient({ transport, session: createSession() }), transport };
}

describe('IgClient facade', () => {
  it('delegates user reads to the user endpoints', async () => {
    const { ig, transport } = clientWith(() =>
      json({ status: 'ok', user: { pk: 7, username: 'x' } }),
    );

    const byId = await ig.user.info('7');
    const byName = await ig.user.infoByUsername('x');

    expect(byId.pk).toBe('7');
    expect(byName.username).toBe('x');
    expect(transport.requests[0]?.url).toContain('/api/v1/users/7/info/');
    expect(transport.requests[1]?.url).toContain('/api/v1/users/x/usernameinfo/');
  });

  it('delegates the account profile to current_user', async () => {
    const { ig, transport } = clientWith(() => json({ status: 'ok', user: { pk: 1 } }));
    await ig.account.me();
    expect(transport.requests[0]?.url).toContain('/api/v1/accounts/current_user/');
  });

  it('delegates friendship actions and lists', async () => {
    const { ig, transport } = clientWith((req) =>
      req.url.includes('/followers/')
        ? json({ status: 'ok', users: [{ pk: 2, username: 'f' }], next_max_id: '10' })
        : json({ status: 'ok', friendship_status: { following: true } }),
    );

    const followed = await ig.friendship.follow('42');
    const page = await ig.friendship.followers('42');

    expect(followed.following).toBe(true);
    expect(transport.requests[0]?.url).toContain('/api/v1/friendships/create/42/');
    expect(page.items[0]?.username).toBe('f');
    expect(page.nextMaxId).toBe('10');
  });

  it('walks a list through the facade iterator', async () => {
    let call = 0;
    const { ig } = clientWith(() => {
      call += 1;
      return json(
        call === 1
          ? { status: 'ok', users: [{ pk: 1, username: 'a' }], next_max_id: 'p2' }
          : { status: 'ok', users: [{ pk: 2, username: 'b' }] },
      );
    });

    const names: string[] = [];
    for await (const user of ig.friendship.paginateFollowing('42')) {
      names.push(user.username ?? '');
    }
    expect(names).toEqual(['a', 'b']);
  });

  it('delegates the user feed and its iterator', async () => {
    let call = 0;
    const { ig } = clientWith(() => {
      call += 1;
      return json(
        call === 1
          ? { status: 'ok', items: [{ pk: 1 }], next_max_id: 'p2' }
          : { status: 'ok', items: [{ pk: 2 }] },
      );
    });

    const ids: (string | undefined)[] = [];
    for await (const media of ig.feed.paginateUser('42')) {
      ids.push(media.pk);
    }
    expect(ids).toEqual(['1', '2']);
  });

  it('exposes the session and the underlying engine', () => {
    const { ig } = clientWith(() => json({}));
    expect(ig.session.device.uuid).toBeDefined();
    expect(ig.client).toBeDefined();
  });

  it('logs in through the CAA flow and returns the logged-in user', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pub = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');
    const bundle = JSON.stringify({
      login_response: JSON.stringify({ logged_in_user: { pk: 999 } }),
      headers: JSON.stringify({ 'IG-Set-Authorization': 'Bearer IGT:2:tok' }),
      cookies: '',
    });

    const transport = new FakeTransport((req) => {
      if (req.url.includes('launcher/sync')) {
        return {
          status: 200,
          headers: {
            'ig-set-password-encryption-key-id': '173',
            'ig-set-password-encryption-pub-key': pub,
          },
          body: '{"status":"ok"}',
        };
      }
      if (req.url.includes('graphql_www')) {
        return json({ data: { xfb_usdid_registration: { success: true } } });
      }
      if (req.url.includes('process_client_data_and_redirect')) {
        return json({
          status: 'ok',
          layout: {
            bloks_payload: {
              data: [{ data: { key: 'CAA_ACCOUNT_ACCESS_CONTEXT:aac', initial: 'AAC1' } }],
            },
          },
        });
      }
      if (req.url.includes('attestation/create_android_keystore')) {
        return json({ status: 'ok', challenge_nonce: 'N1' });
      }
      if (req.url.includes('send_login_request')) {
        return json({
          status: 'ok',
          layout: { bloks_payload: { action: `(x, ${JSON.stringify(bundle)})` } },
        });
      }
      return json({ status: 'ok' });
    });
    const ig = new IgClient({
      transport,
      store: new MemorySessionStore(),
      session: createSession(),
    });

    const user = await ig.login({ username: 'u', password: 'p' });

    expect(user).toMatchObject({ logged_in_user: { pk: 999 } });
    expect(ig.session.auth.userId).toBe('999');
  });
});
