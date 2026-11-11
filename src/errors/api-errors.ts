import { IgError, IgResponseError } from './ig-error';

/** What a typed API error carries from the response. */
export interface ApiErrorPayload {
  readonly message?: string;
  readonly errorType?: string;
  readonly status?: string;
  /** The full parsed response, so resolution flows can read two_factor_info, challenge, etc. */
  readonly raw?: Record<string, unknown>;
}

/** A failed private-API call, carrying the status and the parsed error payload. */
export class IgApiError extends IgResponseError {
  readonly payload: ApiErrorPayload;

  constructor(
    message: string,
    statusCode: number,
    payload: ApiErrorPayload = {},
    options?: ErrorOptions,
  ) {
    super(message, statusCode, options);
    this.payload = payload;
  }
}

// Each subclass only exists so callers can branch with instanceof. The name is
// taken from new.target in the base, so no per-class body is needed.

/** The session expired or was logged out (`login_required`). Log in again. */
export class LoginRequiredError extends IgApiError {}

/** A login stopped at the two-factor step. */
export class TwoFactorRequiredError extends IgApiError {}

/**
 * A CAA/Bloks login that stopped at the two-factor step. Besides the raw response
 * (in `payload.raw`) it carries the account access context the login obtained,
 * which the code submission must echo back, so resolving it needs nothing else.
 */
export class CaaTwoFactorRequiredError extends TwoFactorRequiredError {
  readonly aac: string;

  constructor(
    message: string,
    statusCode: number,
    payload: ApiErrorPayload,
    aac: string,
    options?: ErrorOptions,
  ) {
    super(message, statusCode, payload, options);
    this.aac = aac;
  }
}

/** Instagram wants a verification (a code or a check in the app) before it goes on. */
export class ChallengeRequiredError extends IgApiError {}

/** The account is suspended. Retrying does not help. */
export class AccountSuspendedError extends IgApiError {}

/** Instagram blocked this action for now ("try again later"), often after doing it too often. */
export class FeedbackRequiredError extends IgApiError {}

/** The request was flagged as automated. */
export class SentryBlockError extends IgApiError {}

/** Too many requests in a short time. Slow down before the next one. */
export class RateLimitError extends IgApiError {}

/** The password is wrong. */
export class BadPasswordError extends IgApiError {}

/** The one-time code submitted at a login challenge or two-factor step was not accepted. */
export class InvalidVerificationCodeError extends IgApiError {}

/** "Please wait a few minutes before you try again": too many attempts in a row. */
export class PleaseWaitError extends IgApiError {}

/** A 403 that is not an expired session: the account may not do this. */
export class ClientForbiddenError extends IgApiError {}

/** The response body could not be parsed as JSON. */
export class ClientJsonError extends IgError {}

/**
 * A response parsed as JSON but did not match the endpoint's schema. Carries the
 * raw decoded body so a caller can inspect what drifted, instead of leaking a
 * raw zod error.
 */
export class ClientSchemaError extends IgError {
  readonly raw: unknown;

  constructor(message: string, raw: unknown, options?: ErrorOptions) {
    super(message, options);
    this.raw = raw;
  }
}
