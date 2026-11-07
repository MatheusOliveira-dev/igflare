import { describe, it, expect } from 'vitest';
import {
  startChallenge,
  selectChallengeMethod,
  submitChallengeCode,
  CHALLENGE_EMAIL,
  type Challenge,
} from './challenge';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { ChallengeRequiredError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

function challengeError(apiPath?: string): ChallengeRequiredError {
  return new ChallengeRequiredError('challenge_required', 400, {
    raw: { challenge: apiPath === undefined ? {} : { api_path: apiPath } },
  });
}

describe('startChallenge', () => {
  it('normalizes the api_path and fetches the step', async () => {
    const fake = new FakeTransport(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ step_name: 'select_verify_method' }),
    }));
    const client = new PrivateClient({ transport: fake, session: createSession() });

    const challenge = await startChallenge(client, challengeError('/api/v1/challenge/abc/'));

    expect(challenge.apiPath).toBe('/challenge/abc/');
    expect(challenge.data['step_name']).toBe('select_verify_method');
    expect(fake.requests[0]?.url).toContain('/api/challenge/abc/');
  });

  it('strips a plain /api/ prefix', async () => {
    const fake = new FakeTransport(() => ({ status: 200, headers: {}, body: '{}' }));
    const client = new PrivateClient({ transport: fake, session: createSession() });
    const challenge = await startChallenge(client, challengeError('/api/challenge/xyz/'));
    expect(challenge.apiPath).toBe('/challenge/xyz/');
  });

  it('leaves a path without an /api prefix unchanged', async () => {
    const fake = new FakeTransport(() => ({ status: 200, headers: {}, body: '{}' }));
    const client = new PrivateClient({ transport: fake, session: createSession() });
    const challenge = await startChallenge(client, challengeError('/challenge/xyz/'));
    expect(challenge.apiPath).toBe('/challenge/xyz/');
  });

  it('throws when there is no api_path', async () => {
    const fake = new FakeTransport(() => ({ status: 200, headers: {}, body: '{}' }));
    const client = new PrivateClient({ transport: fake, session: createSession() });
    await expect(startChallenge(client, challengeError())).rejects.toBeInstanceOf(IgError);
  });
});

describe('selectChallengeMethod and submitChallengeCode', () => {
  const challenge: Challenge = { apiPath: '/challenge/abc/', data: {} };

  it('posts the chosen channel', async () => {
    const fake = new FakeTransport(() => ({ status: 200, headers: {}, body: '{"status":"ok"}' }));
    const client = new PrivateClient({ transport: fake, session: createSession() });
    await selectChallengeMethod(client, challenge, CHALLENGE_EMAIL);
    expect(fake.requests[0]?.body).toContain('signed_body=SIGNATURE.');
    expect(fake.requests[0]?.url).toContain('/api/challenge/abc/');
  });

  it('submits the code and finalizes the session', async () => {
    const fake = new FakeTransport(() => ({
      status: 200,
      headers: { 'ig-set-authorization': 'Bearer IGT:2:z' },
      body: JSON.stringify({ status: 'ok', logged_in_user: { pk: 88 } }),
    }));
    const client = new PrivateClient({ transport: fake, session: createSession() });
    await submitChallengeCode(client, challenge, '123456');
    expect(client.session.auth.userId).toBe('88');
  });
});
