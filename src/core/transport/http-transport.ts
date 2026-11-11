/** The HTTP methods the private API uses. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** One HTTP request as a transport sends it. */
export interface HttpRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string | Uint8Array;
}

/** One HTTP response with the body decoded to text. */
export interface HttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * The HTTP seam. Everything that talks to the network goes through this port so
 * the request and response layers can be tested without touching the network.
 */
export interface HttpTransport {
  /** Sends one request and resolves with the response, whatever its status. */
  request(req: HttpRequest): Promise<HttpResponse>;
}
