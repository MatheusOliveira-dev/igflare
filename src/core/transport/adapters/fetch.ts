import type { HttpRequest, HttpResponse, HttpTransport } from '../http-transport';
import { IgError } from '../../../errors/ig-error';

/**
 * A transport backed by the runtime's global fetch. Fetch adds the browser
 * `sec-fetch-*` headers, which the private API rejects, so Instagram calls go through
 * HttpsTransport. This one is kept for generic use and testing.
 */
export class FetchTransport implements HttpTransport {
  async request(req: HttpRequest): Promise<HttpResponse> {
    let response: Response;
    try {
      response = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        ...(req.body !== undefined ? { body: req.body } : {}),
      });
    } catch (error) {
      throw new IgError(`HTTP request failed: ${req.method} ${req.url}`, { cause: error });
    }

    const body = await response.text();
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return { status: response.status, headers, body };
  }
}
