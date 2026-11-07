import { describe, it, expect } from 'vitest';
import { twoFactorLogin } from './two-factor';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { TwoFactorRequiredError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

function twoFactorError(identifier?: string): TwoFactorRequiredError {
  return new TwoFactorRequiredError('two_factor_required', 400, {
    raw: {
      two_factor_info: identifier === undefined ? {} : { two_factor_identifier: identifier },
    },
  });
}

describe('twoFactorLogin', () => {
  it('submits the code and identifier, then stores the user id', async () => {
    const fake = new FakeTransport(() => ({
      status: 200,
      headers: { 'ig-set-authorization': 'Bearer IGT:2:y' },
      body: JSON.stringify({ status: 'ok', logged_in_user: { pk: 55 } }),
    }));
    const privateClient = new PrivateClient({ transport: fake, session: createSession() });

    const json = await twoFactorLogin(privateClient, twoFactorError('ID123'), {
      username: 'u',
      code: '654321',
    });

    expect(json.status).toBe('ok');
    expect(privateClient.session.auth.userId).toBe('55');
    const req = fake.requests[0];
    expect(req?.url).toContain('accounts/two_factor_login');
    expect(req?.body).toContain('signed_body=SIGNATURE.');
  });

  it('throws when the error has no two_factor_identifier', async () => {
    const fake = new FakeTransport(() => ({ status: 200, headers: {}, body: '{}' }));
    const privateClient = new PrivateClient({ transport: fake, session: createSession() });
    await expect(
      twoFactorLogin(privateClient, twoFactorError(), { username: 'u', code: '1' }),
    ).rejects.toBeInstanceOf(IgError);
    expect(fake.requests).toHaveLength(0);
  });
});
