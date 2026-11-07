import type { HttpTransport } from '../transport/http-transport';
import { FetchTransport } from '../transport/adapters/fetch';
import type { SessionData, SessionStore } from '../session/session';
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
    this.#transport = options.transport ?? new FetchTransport();
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

  async request(input: PrivateRequestOptions): Promise<PrivateResponseJson> {
    const request = buildPrivateRequest({ ...input, session: this.#session });
    const response = await this.#transport.request(request);
    this.#session = applyResponseToSession(this.#session, response);
    const json = parsePrivateResponse(response);
    if (this.#store !== undefined) {
      await this.#store.save(this.#session);
    }
    return json;
  }
}
