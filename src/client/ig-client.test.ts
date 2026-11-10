import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { IgFlare } from './ig-client';
import { FakeTransport } from '../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../core/transport/http-transport';
import { MemorySessionStore } from '../core/session/adapters/memory';
import { createSession } from '../core/session/session';
import { IgApiError } from '../errors/api-errors';

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function clientWith(handler: (req: HttpRequest) => HttpResponse): {
  ig: IgFlare;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(handler);
  return { ig: new IgFlare({ transport, session: createSession() }), transport };
}

describe('IgFlare facade', () => {
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
    expect(page.nextCursor).toBe('10');
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

  it('delegates media info to the media endpoint', async () => {
    const { ig, transport } = clientWith(() =>
      json({ status: 'ok', items: [{ pk: 1, code: 'abc' }] }),
    );
    const media = await ig.media.info('1_9');
    expect(media.code).toBe('abc');
    expect(transport.requests[0]?.url).toContain('/api/v1/media/1_9/info/');
  });

  it('delegates media actions to the media endpoints', async () => {
    const { ig, transport } = clientWith((req) =>
      req.url.includes('/comment/')
        ? json({ status: 'ok', comment: { pk: 5, text: 'hi' } })
        : json({ status: 'ok' }),
    );

    await ig.media.like('1_9');
    const comment = await ig.media.comment('1_9', 'hi');

    expect(transport.requests[0]?.url).toContain('/api/v1/media/1_9/like/');
    expect(comment.text).toBe('hi');
  });

  it('retries a transient 429 by default and then succeeds', async () => {
    let n = 0;
    const transport = new FakeTransport(() => {
      n += 1;
      return n === 1
        ? { status: 429, headers: {}, body: '{}' }
        : { status: 200, headers: {}, body: JSON.stringify({ user: { pk: 1, username: 'a' } }) };
    });
    const ig = new IgFlare({
      transport,
      session: createSession(),
      retry: { sleep: () => Promise.resolve() },
    });

    const user = await ig.user.info('1');
    expect(user.username).toBe('a');
    expect(n).toBe(2);
  });

  it('does not retry when retry is false', async () => {
    const transport = new FakeTransport(() => ({ status: 429, headers: {}, body: '{}' }));
    const ig = new IgFlare({ transport, session: createSession(), retry: false });
    await expect(ig.user.info('1')).rejects.toBeInstanceOf(IgApiError);
  });

  it('delegates the home timeline to the timeline endpoint', async () => {
    const { ig, transport } = clientWith(() =>
      json({ status: 'ok', feed_items: [{ media_or_ad: { pk: 9, code: 't' } }] }),
    );
    const page = await ig.feed.timeline();
    expect(page.items[0]?.code).toBe('t');
    expect(transport.requests[0]?.url).toContain('/api/v1/feed/timeline/');
  });

  it('delegates direct inbox and send to the direct endpoints', async () => {
    const { ig, transport } = clientWith((req) =>
      req.url.includes('broadcast/text')
        ? json({ status: 'ok', payload: { item_id: 'i1', thread_id: 't1' } })
        : json({ status: 'ok', inbox: { threads: [{ thread_id: 't1' }], has_older: false } }),
    );

    const inbox = await ig.direct.inbox();
    const sent = await ig.direct.sendText('hi', { threadId: 't1' });

    expect(inbox.items[0]?.thread_id).toBe('t1');
    expect(sent.item_id).toBe('i1');
    expect(transport.requests[0]?.url).toContain('/api/v1/direct_v2/inbox/');
  });

  it('delegates photo upload and media delete', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90]);
    const { ig, transport } = clientWith((req) =>
      req.url.includes('rupload_igphoto')
        ? json({ upload_id: 'U1', status: 'ok' })
        : json({ status: 'ok', media: { pk: 1, code: 'up' } }),
    );

    const media = await ig.upload.photo(jpeg, { caption: 'c' });
    expect(media.code).toBe('up');

    await ig.media.delete('1_9', 'PHOTO');
    expect(transport.requests.at(-1)?.url).toContain('/api/v1/media/1_9/delete/');
  });

  it('delegates video upload', async () => {
    const mp4 = new Uint8Array([0, 1, 2, 3]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90]);
    const { ig } = clientWith((req) =>
      req.url.includes('rupload')
        ? json({ upload_id: 'V1', status: 'ok' })
        : json({ status: 'ok', media: { pk: 1, code: 'vv' } }),
    );
    const media = await ig.upload.video(mp4, jpeg, { durationMs: 5000, width: 720, height: 1280 });
    expect(media.code).toBe('vv');
  });

  it('delegates discovery search, hashtag feed and comments/likers', async () => {
    const { ig, transport } = clientWith((req) => {
      if (req.url.includes('/users/search/'))
        return json({ status: 'ok', users: [{ pk: 1, username: 'a' }] });
      if (req.url.includes('/tags/search/'))
        return json({ status: 'ok', results: [{ id: 5, name: 'sun' }] });
      if (req.url.includes('/sections/'))
        return json({
          status: 'ok',
          sections: [{ layout_content: { medias: [{ media: { pk: 9, code: 't' } }] } }],
        });
      if (req.url.includes('/comments/'))
        return json({ status: 'ok', comments: [{ pk: 3, text: 'hi' }] });
      return json({ status: 'ok', users: [{ pk: 2, username: 'b' }] }); // likers
    });

    expect((await ig.search.users('a'))[0]?.username).toBe('a');
    expect((await ig.search.hashtags('s'))[0]?.name).toBe('sun');
    expect((await ig.feed.hashtag('sun')).items[0]?.code).toBe('t');
    expect((await ig.media.comments('1_9')).items[0]?.text).toBe('hi');
    expect((await ig.media.likers('1_9'))[0]?.username).toBe('b');
    expect(transport.requests.some((r) => r.url.includes('/api/v1/users/search/'))).toBe(true);
  });

  it('delegates places search, location feed and the discovery iterators', async () => {
    const { ig } = clientWith((req) => {
      if (req.url.includes('/fbsearch/places/'))
        return json({ status: 'ok', items: [{ location: { pk: 7, name: 'Park' } }] });
      if (req.url.includes('/locations/'))
        return json({
          status: 'ok',
          sections: [{ layout_content: { medias: [{ media: { pk: 1, code: 'l' } }] } }],
        });
      if (req.url.includes('/tags/'))
        return json({
          status: 'ok',
          sections: [{ layout_content: { medias: [{ media: { pk: 2 } }] } }],
        });
      return json({ status: 'ok', comments: [{ pk: 3, text: 'c' }] });
    });

    expect((await ig.search.places('park'))[0]?.name).toBe('Park');
    expect((await ig.feed.location('777')).items[0]?.code).toBe('l');

    const tagIds: (string | undefined)[] = [];
    for await (const m of ig.feed.paginateHashtag('x')) tagIds.push(m.pk);
    expect(tagIds).toEqual(['2']);

    const locIds: (string | undefined)[] = [];
    for await (const m of ig.feed.paginateLocation('777')) locIds.push(m.pk);
    expect(locIds).toEqual(['1']);

    const texts: (string | undefined)[] = [];
    for await (const c of ig.media.paginateComments('1_9')) texts.push(c.text);
    expect(texts).toEqual(['c']);
  });

  it('delegates relationship management actions', async () => {
    const { ig, transport } = clientWith((req) =>
      req.url.includes('/pending/')
        ? json({ status: 'ok', users: [{ pk: 1, username: 'a' }] })
        : json({ status: 'ok', friendship_status: { blocking: true } }),
    );

    expect((await ig.friendship.block('42')).blocking).toBe(true);
    await ig.friendship.approve('42');
    await ig.friendship.mute('42', { stories: true });
    expect((await ig.friendship.pending()).items[0]?.username).toBe('a');

    for await (const u of ig.friendship.paginatePending()) expect(u.username).toBe('a');

    expect(transport.requests.some((r) => r.url.includes('/friendships/block/42/'))).toBe(true);
    expect(
      transport.requests.some((r) => r.url.includes('/mute_posts_or_story_from_follow/')),
    ).toBe(true);
  });

  it('delegates stories: tray, user stories and story upload', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90]);
    const { ig } = clientWith((req) => {
      if (req.url.includes('/reels_tray/'))
        return json({ status: 'ok', tray: [{ id: 1, user: { pk: 9, username: 'a' } }] });
      if (req.url.includes('/story/')) return json({ status: 'ok', reel: { items: [{ pk: 2 }] } });
      if (req.url.includes('rupload')) return json({ upload_id: 'S1', status: 'ok' });
      return json({ status: 'ok', media: { pk: 3, code: 'st' } });
    });

    expect((await ig.story.tray())[0]?.user?.username).toBe('a');
    expect((await ig.story.user('9'))[0]?.pk).toBe('2');
    expect((await ig.upload.story(jpeg)).code).toBe('st');
  });

  it('delegates profile bio and saved posts', async () => {
    const { ig, transport } = clientWith((req) => {
      if (req.url.includes('/set_biography/'))
        return json({ status: 'ok', user: { pk: 1, username: 'me', biography: 'hi' } });
      if (req.url.includes('/feed/saved/'))
        return json({ status: 'ok', items: [{ media: { pk: 2, code: 's' } }] });
      return json({ status: 'ok' }); // save/unsave
    });

    expect((await ig.account.setBiography('hi')).biography).toBe('hi');
    await ig.media.save('1_9');
    await ig.media.unsave('1_9');
    expect((await ig.media.saved()).items[0]?.code).toBe('s');
    for await (const m of ig.media.paginateSaved()) expect(m.code).toBe('s');
    expect(transport.requests.some((r) => r.url.includes('/media/1_9/save/'))).toBe(true);
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
    const ig = new IgFlare({
      transport,
      store: new MemorySessionStore(),
      session: createSession(),
    });

    const user = await ig.login({ username: 'u', password: 'p' });

    expect(user).toMatchObject({ logged_in_user: { pk: 999 } });
    expect(ig.session.auth.userId).toBe('999');
  });
});
