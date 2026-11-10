import { IgError, IgResponseError } from './ig-error';

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
export class LoginRequiredError extends IgApiError {}
export class TwoFactorRequiredError extends IgApiError {}
export class ChallengeRequiredError extends IgApiError {}
export class AccountSuspendedError extends IgApiError {}
export class FeedbackRequiredError extends IgApiError {}
export class SentryBlockError extends IgApiError {}
export class RateLimitError extends IgApiError {}
export class BadPasswordError extends IgApiError {}
export class PleaseWaitError extends IgApiError {}
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
