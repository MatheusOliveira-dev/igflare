import type { HttpRequest, HttpResponse, HttpTransport } from '../http-transport';

export type FakeHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

/** A transport driven by a handler. Records every request for assertions. */
export class FakeTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  readonly #handler: FakeHandler;

  constructor(handler: FakeHandler) {
    this.#handler = handler;
  }

  request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    return Promise.resolve(this.#handler(req));
  }
}
