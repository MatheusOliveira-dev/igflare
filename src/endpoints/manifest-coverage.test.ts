import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { endpoints } from '../generated/endpoints';

const here = dirname(fileURLToPath(import.meta.url));

function source(relative: string): string {
  return readFileSync(join(here, relative), 'utf8');
}

// Every REST endpoint the handlers call must be declared in manifest/endpoints.json
// and reached through the generated `endpoints` registry. This pins the hand-written
// CAA surface to the single source of truth: a path change has to go through the
// manifest + `npm run gen`, and these tests fail if a handler reintroduces a literal.
describe('manifest coverage of the hand-written endpoints', () => {
  it('declares each covered endpoint with the expected method and path', () => {
    expect(endpoints.accountsLogin).toEqual({ method: 'POST', path: '/api/v1/accounts/login/' });
    expect(endpoints.accountsCurrentUser).toEqual({
      method: 'GET',
      path: '/api/v1/accounts/current_user/',
    });
    expect(endpoints.accountsEditProfile).toEqual({
      method: 'POST',
      path: '/api/v1/accounts/edit_profile/',
    });
    expect(endpoints.accountsUpdateBioLinks.path).toBe('/api/v1/accounts/update_bio_links/');
    expect(endpoints.accountsRemoveBioLinks.path).toBe('/api/v1/accounts/remove_bio_links/');
    expect(endpoints.newsInbox).toEqual({ method: 'GET', path: '/api/v1/news/inbox/' });
    expect(endpoints.directBroadcastRavenAttachment.path).toBe(
      '/api/v1/direct_v2/threads/broadcast/raven_attachment/',
    );
    expect(endpoints.directBroadcastVoiceAttachment.path).toBe(
      '/api/v1/direct_v2/threads/broadcast/voice_attachment/',
    );
    expect(endpoints.directBroadcastStoryShare.path).toBe(
      '/api/v1/direct_v2/threads/broadcast/story_share/',
    );
    expect(endpoints.mediaConfigureSidecar.path).toBe('/api/v1/media/configure_sidecar/');
    expect(endpoints.collectionsList).toEqual({ method: 'GET', path: '/api/v1/collections/list/' });
    expect(endpoints.collectionsCreate.path).toBe('/api/v1/collections/create/');
    expect(endpoints.collectionsDelete.path).toBe('/api/v1/collections/{id}/delete/');
    expect(endpoints.feedCollection.path).toBe('/api/v1/feed/collection/{id}/');
    expect(endpoints.feedLiked.path).toBe('/api/v1/feed/liked/');
    expect(endpoints.attestationCreateAndroidKeystore).toEqual({
      method: 'POST',
      path: '/api/v1/attestation/create_android_keystore/',
    });
    expect(endpoints.bloksAsyncAction).toEqual({
      method: 'POST',
      path: '/api/v1/bloks/async_action/',
    });
    expect(endpoints.launcherSync).toEqual({ method: 'POST', path: '/api/v1/launcher/sync/' });
  });

  // The guard: a handler's `endpoint:` value must resolve from the registry, never
  // from an inline REST path literal. Only the quoted/backtick value right after
  // `endpoint:` is inspected, so human labels (e.g. the friendly-name header) are
  // untouched. graphql_www is exempt (rawUrl GraphQL host, not /api/v1).
  it.each([
    ['auth/login.ts', ['accounts/login/', 'launcher/sync/']],
    ['user/current-user.ts', ['accounts/current_user/']],
    ['auth/caa-login.ts', ['attestation/create_android_keystore/']],
    ['auth/bloks.ts', ['bloks/async_action/']],
  ])('%s drives each endpoint from the registry, not an inline literal', (file, literals) => {
    const text = source(file);
    const values = [...text.matchAll(/endpoint:\s*[`'"]([^`'"]*)/g)].map((match) => match[1] ?? '');
    for (const literal of literals) {
      expect(values.some((value) => value.includes(literal))).toBe(false);
    }
  });
});
