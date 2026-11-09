import { describe, it, expect } from 'vitest';
import { bloksAsyncAction } from './bloks';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';

function okBloks(): FakeTransport {
  return new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ status: 'ok', layout: { bloks_payload: { data: [] } } }),
  }));
}

describe('bloksAsyncAction', () => {
  it('posts a form-encoded, unsigned Bloks payload to the action endpoint', async () => {
    const fake = okBloks();
    const client = new PrivateClient({ transport: fake, session: createSession() });

    const json = await bloksAsyncAction(client, 'com.bloks.www.caa.login.x', { k: 'v' });
    expect(json.status).toBe('ok');

    const request = fake.requests[0];
    expect(request?.url).toContain('/api/v1/bloks/async_action/com.bloks.www.caa.login.x/');
    expect(request?.headers['X-FB-Friendly-Name']).toBe(
      'IgApi: bloks/async_action/com.bloks.www.caa.login.x/',
    );
    expect(request?.headers['Content-Type']).toContain('application/x-www-form-urlencoded');

    // Unsigned form body: not a signed_body, fields recoverable as form data.
    const body = request?.body ?? '';
    expect(body).not.toContain('signed_body=');
    const form = new URLSearchParams(body);
    expect(form.get('params')).toBe('{"k":"v"}');
    expect(form.get('_uuid')).toBe(client.session.device.uuid);
    expect(form.get('bloks_versioning_id')).toBe(client.session.profile.bloksVersioningId);
  });

  it('applies domain and extra headers, and a bloks versioning id override', async () => {
    const fake = okBloks();
    const client = new PrivateClient({ transport: fake, session: createSession() });

    await bloksAsyncAction(
      client,
      'act',
      { k: 'v' },
      {
        domain: 'b.i.instagram.com',
        bloksVersioningId: 'OVERRIDE',
        extraHeaders: { 'X-IG-Attest-Params': '{}' },
      },
    );

    const request = fake.requests[0];
    expect(request?.url).toContain('https://b.i.instagram.com/');
    expect(request?.headers['X-IG-Attest-Params']).toBe('{}');
    expect(new URLSearchParams(request?.body ?? '').get('bloks_versioning_id')).toBe('OVERRIDE');
  });
});
