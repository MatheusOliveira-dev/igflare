import type { HttpResponse } from '../transport/http-transport';
import {
  IgApiError,
  LoginRequiredError,
  TwoFactorRequiredError,
  ChallengeRequiredError,
  AccountSuspendedError,
  FeedbackRequiredError,
  SentryBlockError,
  RateLimitError,
  BadPasswordError,
  PleaseWaitError,
  ClientForbiddenError,
  ClientJsonError,
} from '../../errors/api-errors';
import type { ApiErrorPayload } from '../../errors/api-errors';

export interface PrivateResponseJson {
  readonly status?: string;
  readonly message?: string;
  readonly error_type?: string;
  readonly two_factor_info?: unknown;
  readonly challenge?: { readonly url?: string } | null;
  readonly [key: string]: unknown;
}

function toPayload(json: PrivateResponseJson): ApiErrorPayload {
  return {
    raw: json,
    ...(json.message !== undefined ? { message: json.message } : {}),
    ...(json.error_type !== undefined ? { errorType: json.error_type } : {}),
    ...(json.status !== undefined ? { status: json.status } : {}),
  };
}

function mapError(status: number, json: PrivateResponseJson): IgApiError {
  const message = typeof json.message === 'string' ? json.message : '';
  const errorType = json.error_type;
  const payload = toPayload(json);

  if (message.includes('Please wait a few minutes')) {
    return new PleaseWaitError(message, status, payload);
  }
  if (status === 403) {
    if (message === 'login_required') {
      return new LoginRequiredError(message, status, payload);
    }
    return new ClientForbiddenError(message || 'Forbidden', status, payload);
  }
  if (json.two_factor_info != null || errorType === 'two_factor_required') {
    return new TwoFactorRequiredError(
      message || 'Two-factor authentication required',
      status,
      payload,
    );
  }
  if (message === 'challenge_required') {
    const url = typeof json.challenge?.url === 'string' ? json.challenge.url : '';
    if (url.includes('/suspended/')) {
      return new AccountSuspendedError(message, status, payload);
    }
    return new ChallengeRequiredError(message, status, payload);
  }
  if (message === 'feedback_required') {
    return new FeedbackRequiredError(message, status, payload);
  }
  if (errorType === 'sentry_block') {
    return new SentryBlockError(message || 'Sentry block', status, payload);
  }
  if (errorType === 'rate_limit_error') {
    return new RateLimitError(message || 'Rate limited', status, payload);
  }
  if (errorType === 'bad_password') {
    return new BadPasswordError(message || 'Incorrect password', status, payload);
  }
  return new IgApiError(message || `Request failed with status ${String(status)}`, status, payload);
}

/** Parses a private-API response, throwing a typed error on failure. */
export function parsePrivateResponse(response: HttpResponse): PrivateResponseJson {
  let json: PrivateResponseJson;
  try {
    json = JSON.parse(response.body) as PrivateResponseJson;
  } catch (error) {
    throw new ClientJsonError(`Response was not JSON (status ${String(response.status)})`, {
      cause: error,
    });
  }
  if (response.status >= 400 || json.status === 'fail') {
    throw mapError(response.status, json);
  }
  return json;
}
