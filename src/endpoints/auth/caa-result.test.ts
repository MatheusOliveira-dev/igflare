import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { applyCaaResult } from './caa-result';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import type { PrivateResponseJson } from '../../core/http/response';

// A real login-after-challenge response from the Bloks flow, with identity, token and
// cookie values replaced by fakes. The hand-built vectors in the other auth tests
// cannot catch a shape drift in the real payload; this one can.
const LOGIN_SUCCESS = new URL(
  '../../core/http/__fixtures__/caa-login-success.json',
  import.meta.url,
);

describe('applyCaaResult on a real login response', () => {
  it('reads the session out of the embedded login bundle', async () => {
    const result = JSON.parse(readFileSync(LOGIN_SUCCESS, 'utf8')) as PrivateResponseJson;
    const client = new PrivateClient({
      transport: new FakeTransport(() => ({ status: 200, headers: {}, body: '{}' })),
      session: createSession({ auth: { mid: 'MID9' } }),
    });

    const loginResponse = await applyCaaResult(client, result, 'AAC');

    const auth = client.session.auth;
    expect(auth.userId).toBe('10000000001');
    expect(auth.authorization).toMatch(/^Bearer IGT:2:/);
    expect(Object.keys(auth.cookies ?? {})).toEqual(
      expect.arrayContaining(['csrftoken', 'ds_user_id', 'sessionid']),
    );
    expect(auth.cookies?.['ds_user_id']).toBe('10000000001');
    expect(loginResponse.status).toBe('ok');
  });
});
