import type { HttpTransport, HttpResponse } from '../transport/http-transport';
import { HttpsTransport } from '../transport/adapters/https';
import type { AuthState, SessionData, SessionStore } from '../session/session';
import { createSession } from '../session/session';
import { buildPrivateRequest } from './request-builder';
import type { PrivateRequestInput } from './request-builder';
import { parsePrivateResponse } from './response';
import type { PrivateResponseJson } from './response';
import { applyResponseToSession } from './session-update';

export interface PrivateClientOptions {
  readonly transport?: HttpTransport;
  readonly store?: SessionStore;
  readonly session?: SessionData;
}

export type PrivateRequestOptions = Omit<PrivateRequestInput, 'session'>;

/** Ties the three seams together: build a request, send it, update the session. */
export class PrivateClient {
  readonly #transport: HttpTransport;
  readonly #store: SessionStore | undefined;
  #session: SessionData;

  constructor(options: PrivateClientOptions = {}) {
    this.#transport = options.transport ?? new HttpsTransport();
    this.#store = options.store;
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

  /** Sends a request and parses it, throwing a typed error on failure. */
  async request(input: PrivateRequestOptions): Promise<PrivateResponseJson> {
    return parsePrivateResponse(await this.send(input));
  }

  /** Merges fields into the session auth (e.g. the user id after login). */
  patchAuth(auth: Partial<AuthState>): void {
    this.#session = { ...this.#session, auth: { ...this.#session.auth, ...auth } };
  }

  async persist(): Promise<void> {
    if (this.#store !== undefined) {
      await this.#store.save(this.#session);
    }
  }
}
