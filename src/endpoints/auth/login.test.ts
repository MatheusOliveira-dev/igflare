import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { login, fetchPasswordPublicKey } from './login';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { IgError } from '../../errors/ig-error';
import { BadPasswordError } from '../../errors/api-errors';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubKeyB64 = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');

function transport(onLogin: (req: HttpRequest) => HttpResponse): FakeTransport {
  return new FakeTransport((req) => {
    if (req.url.includes('launcher/sync')) {
      return {
        status: 200,
        headers: {
          'ig-set-password-encryption-key-id': '173',
          'ig-set-password-encryption-pub-key': pubKeyB64,
        },
        body: '{"status":"ok"}',
      };
    }
    return onLogin(req);
  });
}

function client(fake: FakeTransport): PrivateClient {
  return new PrivateClient({ transport: fake, session: createSession() });
}

describe('login', () => {
  it('logs in, signs the request and stores the user id and authorization', async () => {
    const fake = transport(() => ({
      status: 200,
      headers: { 'ig-set-authorization': 'Bearer IGT:2:x' },
      body: JSON.stringify({ status: 'ok', logged_in_user: { pk: 123 } }),
    }));
    const privateClient = client(fake);

    const json = await login(privateClient, { username: 'u', password: 'p' });

    expect(json.status).toBe('ok');
    expect(privateClient.session.auth.userId).toBe('123');
    expect(privateClient.session.auth.authorization).toBe('Bearer IGT:2:x');
    const loginReq = fake.requests.find((r) => r.url.includes('accounts/login'));
    expect(loginReq?.body).toContain('signed_body=SIGNATURE.');
  });

  it('leaves the user id unset when the response has no logged_in_user', async () => {
    const privateClient = client(
      transport(() => ({ status: 200, headers: {}, body: '{"status":"ok"}' })),
    );
    await login(privateClient, { username: 'u', password: 'p' });
    expect(privateClient.session.auth.userId).toBeUndefined();
  });

  it('surfaces a bad password as a typed error', async () => {
    const privateClient = client(
      transport(() => ({
        status: 400,
        headers: {},
        body: JSON.stringify({ error_type: 'bad_password', message: 'wrong' }),
      })),
    );
    await expect(login(privateClient, { username: 'u', password: 'p' })).rejects.toBeInstanceOf(
      BadPasswordError,
    );
  });
});

describe('fetchPasswordPublicKey', () => {
  it('throws when the key headers are missing', async () => {
    const fake = new FakeTransport(() => ({ status: 200, headers: {}, body: '{}' }));
    await expect(fetchPasswordPublicKey(client(fake))).rejects.toBeInstanceOf(IgError);
  });
});
