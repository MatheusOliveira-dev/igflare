import { describe, it, expect } from 'vitest';
import type { HttpResponse } from '../transport/http-transport';
import { parsePrivateResponse } from './response';
import {
  IgApiError,
  LoginRequiredError,
  ClientForbiddenError,
  TwoFactorRequiredError,
  ChallengeRequiredError,
  AccountSuspendedError,
  FeedbackRequiredError,
  SentryBlockError,
  RateLimitError,
  BadPasswordError,
  PleaseWaitError,
  ClientJsonError,
} from '../../errors/api-errors';

function res(status: number, body: unknown): HttpResponse {
  return {
    status,
    headers: {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function thrown(response: HttpResponse): unknown {
  try {
    parsePrivateResponse(response);
  } catch (error) {
    return error;
  }
  throw new Error('expected parsePrivateResponse to throw');
}

describe('parsePrivateResponse success', () => {
  it('returns the parsed json on a 200', () => {
    const json = parsePrivateResponse(res(200, { status: 'ok', value: 1 }));
    expect(json.status).toBe('ok');
    expect(json['value']).toBe(1);
  });

  it('throws ClientJsonError on a non-json body', () => {
    expect(thrown(res(200, 'not json'))).toBeInstanceOf(ClientJsonError);
  });
});

describe('parsePrivateResponse error mapping', () => {
  it('maps 403 login_required', () => {
    const error = thrown(res(403, { message: 'login_required' }));
    expect(error).toBeInstanceOf(LoginRequiredError);
    expect((error as IgApiError).statusCode).toBe(403);
    expect((error as IgApiError).payload.message).toBe('login_required');
  });

  it('maps other 403 to forbidden', () => {
    expect(thrown(res(403, {}))).toBeInstanceOf(ClientForbiddenError);
  });

  it('maps two_factor_info', () => {
    expect(thrown(res(400, { two_factor_info: { x: 1 } }))).toBeInstanceOf(TwoFactorRequiredError);
  });

  it('maps two_factor_required error_type', () => {
    expect(thrown(res(400, { error_type: 'two_factor_required' }))).toBeInstanceOf(
      TwoFactorRequiredError,
    );
  });

  it('maps challenge_required', () => {
    expect(thrown(res(400, { message: 'challenge_required' }))).toBeInstanceOf(
      ChallengeRequiredError,
    );
  });

  it('maps a suspended challenge', () => {
    const error = thrown(
      res(400, { message: 'challenge_required', challenge: { url: '/challenge/suspended/' } }),
    );
    expect(error).toBeInstanceOf(AccountSuspendedError);
  });

  it('maps feedback_required', () => {
    expect(thrown(res(400, { message: 'feedback_required' }))).toBeInstanceOf(
      FeedbackRequiredError,
    );
  });

  it('maps sentry_block', () => {
    expect(thrown(res(400, { error_type: 'sentry_block' }))).toBeInstanceOf(SentryBlockError);
  });

  it('maps rate_limit_error', () => {
    expect(thrown(res(429, { error_type: 'rate_limit_error' }))).toBeInstanceOf(RateLimitError);
  });

  it('maps bad_password', () => {
    expect(thrown(res(400, { error_type: 'bad_password' }))).toBeInstanceOf(BadPasswordError);
  });

  it('maps please-wait messages', () => {
    expect(
      thrown(res(429, { message: 'Please wait a few minutes before you try again.' })),
    ).toBeInstanceOf(PleaseWaitError);
  });

  it('falls back to IgApiError for an unknown failure', () => {
    const error = thrown(res(500, { message: 'boom' }));
    expect(error).toBeInstanceOf(IgApiError);
    expect((error as IgApiError).statusCode).toBe(500);
  });

  it('treats a 200 with status fail as an error', () => {
    expect(thrown(res(200, { status: 'fail', message: 'feedback_required' }))).toBeInstanceOf(
      FeedbackRequiredError,
    );
  });
});
