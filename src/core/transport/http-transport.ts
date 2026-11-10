export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string | Uint8Array;
}

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
  request(req: HttpRequest): Promise<HttpResponse>;
}
