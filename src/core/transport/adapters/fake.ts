import type { HttpRequest, HttpResponse, HttpTransport } from '../http-transport';

/** Answers each request a `FakeTransport` receives. */
export type FakeHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

/** A transport driven by a handler. Records every request for assertions. */
export class FakeTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  readonly #handler: FakeHandler;

  constructor(handler: FakeHandler) {
    this.#handler = handler;
  }

  /** Records the request and returns what the handler answers. */
  request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    return Promise.resolve(this.#handler(req));
  }
}
