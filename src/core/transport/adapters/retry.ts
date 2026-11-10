import type { HttpRequest, HttpResponse, HttpTransport } from '../http-transport';

/** Tuning for {@link RetryTransport}. All fields have conservative defaults. */
export interface RetryOptions {
  /** Maximum retries after the first attempt. Default 3 (4 attempts total). */
  readonly maxRetries?: number;
  /** Base backoff in ms, doubled per attempt. Default 1000. */
  readonly baseDelayMs?: number;
  /** Backoff ceiling in ms. Default 30000. */
  readonly maxDelayMs?: number;
  /** Delay primitive; injectable so tests do not actually wait. Default setTimeout. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Jitter source in [0,1). Default Math.random. */
  readonly random?: () => number;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
// Instagram rate-limits can arrive as HTTP 200 with this message in the body.
const PLEASE_WAIT = 'Please wait a few minutes';

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses a `Retry-After` header (delta-seconds) into ms, or undefined. */
function retryAfterMs(response: HttpResponse): number | undefined {
  const header = response.headers['retry-after'];
  if (header === undefined) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/**
 * An {@link HttpTransport} decorator that retries transient failures with
 * exponential backoff and full jitter. It retries on connection errors, HTTP
 * 429/502/503/504, and the "please wait" rate-limit body, honoring a `Retry-After`
 * header when present. It does not retry 500 (ambiguous) or other 4xx (client
 * errors). The retry set is method-agnostic: the SDK's mutations are idempotent
 * (follow/like) or carry an idempotence token (comment), and every retryable
 * signal means the request was rejected rather than applied.
 */
export class RetryTransport implements HttpTransport {
  readonly #inner: HttpTransport;
  readonly #maxRetries: number;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;

  constructor(inner: HttpTransport, options: RetryOptions = {}) {
    this.#inner = inner;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#baseDelayMs = options.baseDelayMs ?? 1000;
    this.#maxDelayMs = options.maxDelayMs ?? 30000;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt += 1) {
      const canRetry = attempt < this.#maxRetries;
      let response: HttpResponse;
      try {
        response = await this.#inner.request(req);
      } catch (error) {
        if (!canRetry) {
          throw error;
        }
        await this.#backoff(attempt, undefined);
        continue;
      }
      if (canRetry && this.#isRetryable(response)) {
        await this.#backoff(attempt, retryAfterMs(response));
        continue;
      }
      return response;
    }
  }

  #isRetryable(response: HttpResponse): boolean {
    return RETRYABLE_STATUS.has(response.status) || response.body.includes(PLEASE_WAIT);
  }

  #backoff(attempt: number, retryAfter: number | undefined): Promise<void> {
    if (retryAfter !== undefined) {
      return this.#sleep(Math.min(retryAfter, this.#maxDelayMs));
    }
    const ceiling = Math.min(this.#maxDelayMs, this.#baseDelayMs * 2 ** attempt);
    return this.#sleep(Math.floor(this.#random() * ceiling));
  }
}
