import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { IgFlare } from './ig-client';
import { FakeTransport } from '../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../core/transport/http-transport';
import { MemorySessionStore } from '../core/session/adapters/memory';
import { createSession } from '../core/session/session';
import { sampleMp4 } from '../core/media/__fixtures__/mp4';
import { IgApiError, CaaTwoFactorRequiredError, LoginRequiredError } from '../errors/api-errors';

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

/** A hashtag search page holding the given media in one grid unit. */
function serpPage(medias: Record<string, unknown>[]): unknown {
  return {
    data: {
      '1$xdt_fbsearch__top_serp_graphql(request_data:{})': {
        edges: [{ node: { __typename: 'XDTTopSerpMediaGridUnit', items: medias } }],
        page_info: { has_next_page: false },
      },
    },
  };
}

const { publicKey: caaPublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const caaPubKeyB64 = Buffer.from(caaPublicKey.export({ type: 'spki', format: 'pem' })).toString(
  'base64',
);

/** A send-login response that embeds a successful login bundle. */
function loginResponse(pk: number): HttpResponse {
  const bundle = JSON.stringify({
    login_response: JSON.stringify({ logged_in_user: { pk } }),
    headers: JSON.stringify({ 'IG-Set-Authorization': 'Bearer IGT:2:tok' }),
    cookies: '',
  });
  return json({
    status: 'ok',
    layout: { bloks_payload: { action: `(x, ${JSON.stringify(bundle)})` } },
  });
}

/**
 * Serves the CAA preflight (password key, USDID, aac, keystore); `rest` handles every
 * later step and returns undefined to fall through to a bare ok response.
 */
function caaFlowTransport(rest: (req: HttpRequest) => HttpResponse | undefined): FakeTransport {
  return new FakeTransport((req) => {
    if (req.url.includes('launcher/sync')) {
      return {
        status: 200,
        headers: {
          'ig-set-password-encryption-key-id': '173',
          'ig-set-password-encryption-pub-key': caaPubKeyB64,
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
    return rest(req) ?? json({ status: 'ok' });
  });
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
      if (req.url.includes('/graphql_www')) return json(serpPage([{ pk: '9', code: 't' }]));
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
      if (req.url.includes('/graphql_www')) return json(serpPage([{ pk: '2' }]));
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

  it('delegates album upload', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90]);
    const { ig, transport } = clientWith((req) =>
      req.url.includes('rupload')
        ? json({ upload_id: 'A1', status: 'ok' })
        : json({ status: 'ok', media: { pk: 1, code: 'al', media_type: 8 } }),
    );

    const media = await ig.upload.album([{ photo: jpeg }, { photo: jpeg }], { caption: 'c' });

    expect(media.code).toBe('al');
    expect(transport.requests.at(-1)?.url).toContain('/media/configure_sidecar/');
  });

  it('delegates collections and liked posts', async () => {
    const { ig, transport } = clientWith((req) => {
      if (req.url.includes('/collections/list/'))
        return json({ status: 'ok', items: [{ collection_id: '7', collection_name: 'c' }] });
      if (req.url.includes('/collections/create/'))
        return json({ status: 'ok', collection_id: '8', collection_name: 'new' });
      if (req.url.includes('/delete/')) return json({ status: 'ok' });
      if (req.url.includes('/media/') && req.url.includes('/save/')) return json({ status: 'ok' });
      return json({ status: 'ok', items: [{ media: { pk: 1, code: 'x' } }] });
    });

    expect((await ig.collection.list())[0]?.collection_name).toBe('c');
    expect((await ig.collection.medias('7')).items[0]?.code).toBe('x');
    expect((await ig.collection.liked()).items[0]?.code).toBe('x');
    expect((await ig.collection.create('new', ['1'])).collection_id).toBe('8');
    await ig.collection.delete('8');
    await ig.media.save('1_9', { collectionId: '7' });

    const ids: (string | undefined)[] = [];
    for await (const media of ig.collection.paginateMedias('7')) ids.push(media.pk);
    for await (const media of ig.collection.paginateLiked()) ids.push(media.pk);
    expect(ids).toEqual(['1', '1']);
    expect(transport.requests.some((r) => r.url.includes('/api/v1/feed/collection/7/'))).toBe(true);
  });

  it('delegates highlights', async () => {
    const { ig, transport } = clientWith((req) => {
      if (req.url.includes('/highlights_tray/'))
        return json({ status: 'ok', tray: [{ id: 'highlight:5', title: 'h' }] });
      if (req.url.includes('/reels_media/'))
        return json({ status: 'ok', reels: { 'highlight:5': { id: 'highlight:5', items: [] } } });
      if (req.url.includes('/delete_reel/')) return json({ status: 'ok' });
      return json({ status: 'ok', reel: { id: 'highlight:6', title: 'new' } });
    });

    expect((await ig.highlight.list('7'))[0]?.title).toBe('h');
    expect((await ig.highlight.info('5')).id).toBe('highlight:5');
    expect((await ig.highlight.create('new', ['1_2'])).id).toBe('highlight:6');
    expect((await ig.highlight.edit('6', { title: 'x' })).id).toBe('highlight:6');
    await ig.highlight.delete('6');
    expect(transport.requests.some((r) => r.url.includes('/highlight:6/delete_reel/'))).toBe(true);
  });

  it('delegates hashtag info, location info and nearby places', async () => {
    const { ig } = clientWith((req) => {
      if (req.url.includes('/tags/'))
        return json({ status: 'ok', id: '1', name: 'sun', media_count: 3 });
      if (req.url.includes('/location_info/'))
        return json({ status: 'ok', location_id: '7', name: 'Park' });
      return json({ status: 'ok', venues: [{ external_id: 9, name: 'Cafe' }] });
    });

    expect((await ig.hashtag.info('#sun')).media_count).toBe(3);
    expect((await ig.location.info('7')).name).toBe('Park');
    expect((await ig.location.nearby(1, 2))[0]?.pk).toBe('9');
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
      if (req.url.includes('/news/inbox/'))
        return json({ status: 'ok', old_stories: [{ pk: 'n1' }] });
      if (req.url.includes('/edit_profile/'))
        return json({ status: 'ok', user: { pk: 1, username: 'me', full_name: 'New' } });
      if (req.url.includes('/current_user/'))
        return json({ status: 'ok', user: { pk: 1, username: 'me' } });
      if (req.url.includes('/set_biography/'))
        return json({ status: 'ok', user: { pk: 1, username: 'me', biography: 'hi' } });
      if (req.url.includes('/feed/saved/'))
        return json({ status: 'ok', items: [{ media: { pk: 2, code: 's' } }] });
      return json({ status: 'ok' }); // save/unsave
    });

    expect((await ig.account.setBiography('hi')).biography).toBe('hi');
    expect((await ig.account.setName('New')).full_name).toBe('New');
    expect(await ig.account.links()).toEqual([]);
    expect((await ig.account.activity()).oldItems[0]?.pk).toBe('n1');
    expect(await ig.account.setLink('https://example.com')).toEqual([]);
    expect(await ig.account.removeLinks(['1'])).toEqual([]);
    await ig.media.save('1_9');
    await ig.media.unsave('1_9');
    expect((await ig.media.saved()).items[0]?.code).toBe('s');
    for await (const m of ig.media.paginateSaved()) expect(m.code).toBe('s');
    expect(transport.requests.some((r) => r.url.includes('/media/1_9/save/'))).toBe(true);
  });

  /** A CAA login that stops at the two-factor step, then walks the code-entry screens. */
  function twoFactorFlow(extra?: (req: HttpRequest) => HttpResponse | undefined): FakeTransport {
    const context = (appId: string, value: string): HttpResponse =>
      json({
        status: 'ok',
        layout: {
          bloks_payload: {
            action: `"com.bloks.www.ap.two_step_verification.${appId}" (f4i (dkc "context_data") (dkc "${value}"))`,
          },
        },
      });
    return caaFlowTransport((req) => {
      const handled = extra?.(req);
      if (handled !== undefined) return handled;
      if (req.url.includes('code_entry_async/')) return loginResponse(42);
      if (req.url.includes('/bloks/apps/')) return context('code_entry_async', 'C3');
      if (req.url.includes('entrypoint_async/')) return context('code_entry', 'C2');
      if (req.url.includes('send_login_request')) return context('entrypoint_async', 'C1');
      return undefined;
    });
  }

  it('resolves the second factor from the login twoFactor option', async () => {
    const ig = new IgFlare({ transport: twoFactorFlow(), session: createSession(), retry: false });

    await ig.login({ username: 'u', password: 'p', twoFactor: { code: '123456' } });

    expect(ig.session.auth.userId).toBe('42');
  });

  it('throws a typed error without a code source, then finishes with resolveTwoFactor', async () => {
    const ig = new IgFlare({ transport: twoFactorFlow(), session: createSession(), retry: false });

    const error = await ig
      .login({ username: 'u', password: 'p' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CaaTwoFactorRequiredError);

    await ig.resolveTwoFactor(error as CaaTwoFactorRequiredError, '654321');
    expect(ig.session.auth.userId).toBe('42');
  });

  /** A logged-in flow whose session can be flipped to expired; a login un-expires it. */
  function expiringFlow(): {
    state: { expired: boolean; logins: number };
    transport: FakeTransport;
  } {
    const state = { expired: false, logins: 0 };
    const transport = caaFlowTransport((req) => {
      if (req.url.includes('send_login_request')) {
        state.logins += 1;
        state.expired = false;
        return loginResponse(state.logins);
      }
      if (req.url.includes('/users/')) {
        return state.expired
          ? {
              status: 403,
              headers: {},
              body: JSON.stringify({ message: 'login_required', status: 'fail' }),
            }
          : json({ status: 'ok', user: { pk: 1, username: 'a' } });
      }
      return undefined;
    });
    return { state, transport };
  }

  it('replays the login and repeats the request when the session expires (autoRelogin)', async () => {
    const { state, transport } = expiringFlow();
    const ig = new IgFlare({
      transport,
      session: createSession(),
      retry: false,
      autoRelogin: true,
    });
    await ig.login({ username: 'u', password: 'p' });

    state.expired = true;
    const user = await ig.user.info('1');

    expect(user.username).toBe('a');
    expect(state.logins).toBe(2);
    expect(ig.session.auth.userId).toBe('2');
  });

  const EXPIRED = {
    status: 403,
    headers: {},
    body: JSON.stringify({ message: 'login_required', status: 'fail' }),
  };

  it('does not remember the credentials of a login that failed', async () => {
    const transport = twoFactorFlow((req) => (req.url.includes('/users/') ? EXPIRED : undefined));
    const ig = new IgFlare({
      transport,
      session: createSession(),
      retry: false,
      autoRelogin: true,
    });

    await expect(ig.login({ username: 'u', password: 'p' })).rejects.toBeInstanceOf(
      CaaTwoFactorRequiredError,
    );
    const loginsBefore = transport.requests.filter((r) => r.url.includes('send_login_request'));

    await expect(ig.user.info('1')).rejects.toBeInstanceOf(LoginRequiredError);
    expect(transport.requests.filter((r) => r.url.includes('send_login_request'))).toHaveLength(
      loginsBefore.length,
    );
  });

  it('does not replay a single-use literal code when the session expires', async () => {
    let expired = false;
    const transport = twoFactorFlow((req) =>
      req.url.includes('/users/') && expired ? EXPIRED : undefined,
    );
    const ig = new IgFlare({
      transport,
      session: createSession(),
      retry: false,
      autoRelogin: true,
    });
    await ig.login({ username: 'u', password: 'p', twoFactor: { code: '123456' } });
    const submitted = (): number =>
      transport.requests.filter((r) => r.url.includes('code_entry_async/')).length;
    expect(submitted()).toBe(1);

    expired = true;
    await ig.user.info('1').catch(() => undefined);

    expect(submitted()).toBe(1);
  });

  it('does not re-authenticate by default', async () => {
    const { state, transport } = expiringFlow();
    const ig = new IgFlare({ transport, session: createSession(), retry: false });
    await ig.login({ username: 'u', password: 'p' });

    state.expired = true;

    await expect(ig.user.info('1')).rejects.toBeInstanceOf(LoginRequiredError);
    expect(state.logins).toBe(1);
  });

  it('rethrows the expiry when autoRelogin has no earlier login to replay', async () => {
    const { state, transport } = expiringFlow();
    state.expired = true;
    const ig = new IgFlare({
      transport,
      session: createSession(),
      retry: false,
      autoRelogin: true,
    });

    await expect(ig.user.info('1')).rejects.toBeInstanceOf(LoginRequiredError);
    expect(state.logins).toBe(0);
  });

  it('lets onSessionExpired take precedence over autoRelogin and keeps credentials out', async () => {
    const { state, transport } = expiringFlow();
    let hookCalls = 0;
    const ig = new IgFlare({
      transport,
      session: createSession(),
      retry: false,
      autoRelogin: true,
      onSessionExpired: () => {
        hookCalls += 1;
        state.expired = false;
        return Promise.resolve();
      },
    });
    await ig.login({ username: 'u', password: 'p' });

    state.expired = true;
    await ig.user.info('1');

    expect(hookCalls).toBe(1);
    expect(state.logins).toBe(1); // the hook, not a credential replay, restored the session
  });

  it('delegates direct inbox variants and thread management', async () => {
    const { ig, transport } = clientWith((req) => {
      if (req.url.includes('/pending_inbox/') || req.url.includes('/spam_inbox/'))
        return json({ status: 'ok', inbox: { threads: [{ thread_id: '1' }], has_older: false } });
      if (req.url.includes('/ranked_recipients/'))
        return json({ status: 'ok', ranked_recipients: [{ user: { pk: 1, username: 'a' } }] });
      if (req.url.includes('/get_by_participants/'))
        return json({ status: 'ok', thread: { thread_id: 't' } });
      if (req.url.includes('/create_group_thread/')) return json({ status: 'ok', thread_id: '99' });
      return json({ status: 'ok' });
    });

    expect((await ig.direct.pending()).items[0]?.thread_id).toBe('1');
    expect((await ig.direct.spam()).items[0]?.thread_id).toBe('1');
    for await (const t of ig.direct.paginatePending()) expect(t.thread_id).toBe('1');
    for await (const t of ig.direct.paginateSpam()) expect(t.thread_id).toBe('1');
    expect((await ig.direct.searchRecipients('a'))[0]?.username).toBe('a');
    expect((await ig.direct.findThread(['5']))?.thread_id).toBe('t');
    expect(await ig.direct.createGroup(['1', '2'], 'G')).toBe('99');

    await ig.direct.approve('10');
    await ig.direct.hide('10', { moveToSpam: true });
    await ig.direct.setTitle('10', 'T');
    await ig.direct.addUsers('10', ['3']);
    await ig.direct.mute('10');
    await ig.direct.unmute('10');
    await ig.direct.deleteMessage('10', '20');
    await ig.direct.markSeen('10', '20');

    expect(transport.requests.some((r) => r.url.includes('/threads/10/approve/'))).toBe(true);
    expect(transport.requests.some((r) => r.url.includes('/threads/10/items/20/seen/'))).toBe(true);
  });

  it('delegates the rich direct sends', async () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03,
    ]);
    const { ig, transport } = clientWith((req) => {
      if (req.url.includes('rupload.facebook.com'))
        return req.method === 'GET' ? json({ offset: 0 }) : json({ media_id: '55' });
      if (req.url.includes('/broadcast/reaction/')) return json({ status: 'ok' });
      return json({ status: 'ok', payload: { item_id: 'i1', thread_id: '9' } });
    });
    const target = { threadId: '123' };
    const m4a = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);

    expect((await ig.direct.sendLink('see https://a.b', target)).item_id).toBe('i1');
    await ig.direct.react('123', '456');
    await ig.direct.react('123', '456', { remove: true });
    expect((await ig.direct.shareMedia('1_2', target)).item_id).toBe('i1');
    expect((await ig.direct.shareProfile('77', target)).item_id).toBe('i1');
    expect((await ig.direct.sendPhoto(jpeg, target)).item_id).toBe('i1');
    expect((await ig.direct.shareStory('1_2', target)).item_id).toBe('i1');
    expect((await ig.direct.sendVoice(m4a, target)).item_id).toBe('i1');
    expect((await ig.direct.sendVideo(sampleMp4(), target)).item_id).toBe('i1');

    expect(transport.requests.some((r) => r.url.includes('/broadcast/link/'))).toBe(true);
    expect(transport.requests.some((r) => r.url.includes('/broadcast/photo_attachment/'))).toBe(
      true,
    );
  });

  it('delegates comment and media management extras', async () => {
    const { ig, transport } = clientWith((req) => {
      if (req.url.includes('/inline_child_comments/'))
        return json({ status: 'ok', child_comments: [{ pk: 5, text: 'r' }] });
      if (req.url.includes('/edit_media/'))
        return json({ status: 'ok', media: { pk: 1, caption: { text: 'novo' } } });
      if (req.url.includes('/comment/'))
        return json({ status: 'ok', comment: { pk: 9, text: 'resp' } });
      return json({ status: 'ok' });
    });

    await ig.media.likeComment('111');
    await ig.media.unlikeComment('111');
    await ig.media.pinComment('1_2', '111');
    await ig.media.unpinComment('1_2', '111');
    await ig.media.deleteComments('1_2', ['111', '222']);
    expect((await ig.media.comment('1_2', 'resp', { repliedToCommentId: '111' })).text).toBe(
      'resp',
    );
    expect((await ig.media.replies('1_2', '111')).items[0]?.text).toBe('r');
    for await (const reply of ig.media.paginateReplies('1_2', '111')) expect(reply.text).toBe('r');
    expect((await ig.media.edit('1_2', { caption: 'novo' })).caption?.text).toBe('novo');
    await ig.media.archive('1_2');
    await ig.media.unarchive('1_2');
    await ig.media.pin('1_2');
    await ig.media.unpin('1_2');

    expect(transport.requests.some((r) => r.url.includes('/media/111/comment_like/'))).toBe(true);
    expect(transport.requests.some((r) => r.url.includes('/users/pin_timeline_media/'))).toBe(true);
  });

  it('delegates the step 4 friendship and story extras', async () => {
    const { ig, transport } = clientWith((req) => {
      if (req.url.includes('/set_besties/'))
        return json({ status: 'ok', friendship_statuses: { '7': { is_bestie: true } } });
      return json({ status: 'ok', friendship_status: { followed_by: false } });
    });

    expect((await ig.friendship.removeFollower('7')).followed_by).toBe(false);
    expect((await ig.friendship.addCloseFriend('7')).is_bestie).toBe(true);
    await ig.friendship.removeCloseFriend('7');
    await ig.story.markSeen(['1_2']);

    expect(transport.requests.some((r) => r.url.includes('/api/v2/media/seen/'))).toBe(true);
  });

  it('exposes the session and the underlying engine', () => {
    const { ig } = clientWith(() => json({}));
    expect(ig.session.device.uuid).toBeDefined();
    expect(ig.client).toBeDefined();
  });

  it('logs in through the CAA flow and returns the logged-in user', async () => {
    const transport = caaFlowTransport((req) =>
      req.url.includes('send_login_request') ? loginResponse(999) : undefined,
    );
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
