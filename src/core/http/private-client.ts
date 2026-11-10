import { AsyncLocalStorage } from 'node:async_hooks';
import type { HttpTransport, HttpResponse } from '../transport/http-transport';
import { HttpsTransport } from '../transport/adapters/https';
import type { AuthState, SessionData, SessionStore } from '../session/session';
import { createSession } from '../session/session';
import { buildPrivateRequest } from './request-builder';
import type { PrivateRequestInput } from './request-builder';
import { parsePrivateResponse } from './response';
import type { PrivateResponseJson } from './response';
import { applyResponseToSession } from './session-update';
import { LoginRequiredError } from '../../errors/api-errors';

export interface PrivateClientOptions {
  readonly transport?: HttpTransport;
  readonly store?: SessionStore;
  readonly session?: SessionData;
  /**
   * Called when a request is rejected with `login_required` (the session expired).
   * It should re-authenticate; the rejected request is then repeated once. Several
   * requests failing together share one call, and requests the hook itself makes
   * never trigger it again.
   */
  readonly onSessionExpired?: (error: LoginRequiredError) => Promise<void>;
}

export type PrivateRequestOptions = Omit<PrivateRequestInput, 'session'>;

/** Ties the three seams together: build a request, send it, update the session. */
export class PrivateClient {
  readonly #transport: HttpTransport;
  readonly #store: SessionStore | undefined;
  readonly #onSessionExpired: ((error: LoginRequiredError) => Promise<void>) | undefined;
  /** Marks the async call tree of a running re-authentication. */
  readonly #reauthenticating = new AsyncLocalStorage<true>();
  #refreshing: Promise<void> | undefined;
  #session: SessionData;

  constructor(options: PrivateClientOptions = {}) {
    this.#transport = options.transport ?? new HttpsTransport();
    this.#store = options.store;
    this.#onSessionExpired = options.onSessionExpired;
    this.#session = options.session ?? createSession();
  }

  static async fromStore(
    store: SessionStore,
    options: { readonly transport?: HttpTransport } = {},
  ): Promise<PrivateClient> {
    const session = (await store.load()) ?? createSession();
    return new PrivateClient({ store, session, ...options });
  }

  get session(): SessionData {
    return this.#session;
  }

  /** Sends a request and returns the raw response. Updates and persists the session. */
  async send(input: PrivateRequestOptions): Promise<HttpResponse> {
    const request = buildPrivateRequest({ ...input, session: this.#session });
    const response = await this.#transport.request(request);
    this.#session = applyResponseToSession(this.#session, response);
    await this.persist();
    return response;
  }

  /**
   * Sends a request and parses it, throwing a typed error on failure. If the
   * session expired and an `onSessionExpired` hook is set, it re-authenticates and
   * repeats the request once. A `login_required` rejection means the request was
   * not applied, so repeating a mutation is safe.
   */
  async request(input: PrivateRequestOptions): Promise<PrivateResponseJson> {
    try {
      return parsePrivateResponse(await this.send(input));
    } catch (error) {
      if (!(error instanceof LoginRequiredError) || !this.#canRefresh()) {
        throw error;
      }
      await this.#refreshSession(error);
      return parsePrivateResponse(await this.send(input));
    }
  }

  /** Whether a login_required rejection should trigger the re-authentication hook. */
  #canRefresh(): boolean {
    return this.#onSessionExpired !== undefined && this.#reauthenticating.getStore() === undefined;
  }

  /** Runs the hook once for all requests that failed together. */
  async #refreshSession(error: LoginRequiredError): Promise<void> {
    const hook = this.#onSessionExpired;
    if (hook === undefined) {
      return;
    }
    this.#refreshing ??= this.#reauthenticating
      .run(true, () => hook(error))
      .finally(() => {
        this.#refreshing = undefined;
      });
    await this.#refreshing;
  }

  /** Merges fields into the session auth (e.g. the user id after login). */
  patchAuth(auth: Partial<AuthState>): void {
    this.#session = { ...this.#session, auth: { ...this.#session.auth, ...auth } };
  }

  /** Merges top-level fields into the session (e.g. the USDID identity). */
  patchSession(patch: Partial<SessionData>): void {
    this.#session = { ...this.#session, ...patch };
  }

  async persist(): Promise<void> {
    if (this.#store !== undefined) {
      await this.#store.save(this.#session);
    }
  }
}
