import { describe, it, expect } from 'vitest';
import { buildPrivateRequest, API_DOMAIN } from './request-builder';
import { buildSignedBody } from '../signing/signer';
import { createSession } from '../session/session';

const session = createSession({
  device: {
    uuid: '11111111-1111-4111-8111-111111111111',
    androidDeviceId: 'android-f749eebdc6474685',
  },
});

describe('buildPrivateRequest', () => {
  it('adds the /v1/ prefix and builds the full url', () => {
    const req = buildPrivateRequest({ method: 'GET', endpoint: 'feed/timeline/', session });
    expect(req.url).toBe(`https://${API_DOMAIN}/api/v1/feed/timeline/`);
    expect(req.body).toBeUndefined();
    expect(req.headers['Content-Type']).toBeUndefined();
  });

  it('keeps an endpoint that already starts with a slash', () => {
    const req = buildPrivateRequest({ method: 'GET', endpoint: '/challenge/', session });
    expect(req.url).toBe(`https://${API_DOMAIN}/api/challenge/`);
  });

  it('uses a full /api/ path from the manifest registry verbatim', () => {
    const req = buildPrivateRequest({
      method: 'GET',
      endpoint: '/api/v1/accounts/current_user/',
      session,
    });
    expect(req.url).toBe(`https://${API_DOMAIN}/api/v1/accounts/current_user/`);
  });

  it('appends query params to a full /api/ path without doubling /api', () => {
    const req = buildPrivateRequest({
      method: 'GET',
      endpoint: '/api/v1/accounts/current_user/',
      session,
      query: { edit: 'true' },
    });
    expect(req.url).toBe(`https://${API_DOMAIN}/api/v1/accounts/current_user/?edit=true`);
  });

  it('appends query params', () => {
    const req = buildPrivateRequest({
      method: 'GET',
      endpoint: 'users/search/',
      session,
      query: { q: 'name', count: '20' },
    });
    expect(req.url).toBe(`https://${API_DOMAIN}/api/v1/users/search/?q=name&count=20`);
  });

  it('signs a POST body with the default data injected', () => {
    const req = buildPrivateRequest({
      method: 'POST',
      endpoint: 'accounts/login/',
      session,
      payload: { username: 'u', password: 'p' },
    });
    const expected = buildSignedBody(
      JSON.stringify({
        _uuid: session.device.uuid,
        device_id: session.device.androidDeviceId,
        username: 'u',
        password: 'p',
      }),
    );
    expect(req.body).toBe(expected);
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded; charset=UTF-8');
  });

  it('can skip the signature and the default data', () => {
    const req = buildPrivateRequest({
      method: 'POST',
      endpoint: 'x/',
      session,
      payload: { a: 1 },
      withSignature: false,
      withDefaultData: false,
    });
    expect(req.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('sets the pigeon timestamp from the injected clock', () => {
    const req = buildPrivateRequest({
      method: 'GET',
      endpoint: 'x/',
      session,
      now: 1_700_000_000_000,
    });
    expect(req.headers['X-Pigeon-Rawclienttime']).toBe('1700000000.000');
  });

  it('includes device headers from the session', () => {
    const req = buildPrivateRequest({ method: 'GET', endpoint: 'x/', session });
    expect(req.headers['X-IG-Device-ID']).toBe(session.device.uuid);
    expect(req.headers['X-IG-Android-ID']).toBe('android-f749eebdc6474685');
  });

  it('adds authorization, mid and www-claim headers when authenticated', () => {
    const authed = createSession({
      auth: { userId: '42', authorization: 'Bearer t', mid: 'abc', wwwClaim: 'hmac.xyz' },
    });
    const req = buildPrivateRequest({ method: 'GET', endpoint: 'x/', session: authed });
    expect(req.headers['Authorization']).toBe('Bearer t');
    expect(req.headers['IG-U-DS-USER-ID']).toBe('42');
    expect(req.headers['X-MID']).toBe('abc');
    expect(req.headers['X-IG-WWW-Claim']).toBe('hmac.xyz');
  });
});
