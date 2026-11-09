import { describe, it, expect } from 'vitest';
import { getCurrentUser } from './current-user';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { IgError } from '../../errors/ig-error';

function client(fake: FakeTransport): PrivateClient {
  return new PrivateClient({
    transport: fake,
    session: createSession({ auth: { authorization: 'Bearer IGT:2:tok', userId: '42' } }),
  });
}

describe('getCurrentUser', () => {
  it('fetches the account profile with an authorized GET', async () => {
    const fake = new FakeTransport(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ status: 'ok', user: { pk: 42, username: 'me' } }),
    }));
    const privateClient = client(fake);

    const user = await getCurrentUser(privateClient);
    expect(user).toEqual({ pk: 42, username: 'me' });

    const request = fake.requests[0];
    expect(request?.method).toBe('GET');
    expect(request?.url).toContain('/api/v1/accounts/current_user/?edit=true');
    expect(request?.headers['Authorization']).toBe('Bearer IGT:2:tok');
    expect(request?.body).toBeUndefined();
  });

  it('throws when the response has no user', async () => {
    const fake = new FakeTransport(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ status: 'ok' }),
    }));
    await expect(getCurrentUser(client(fake))).rejects.toBeInstanceOf(IgError);
  });
});
