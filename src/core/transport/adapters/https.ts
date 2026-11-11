import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import type { Readable } from 'node:stream';
import { IgError } from '../../../errors/ig-error';
import type { HttpRequest, HttpResponse, HttpTransport } from '../http-transport';

export interface HttpsTransportOptions {
  /**
   * An HTTP or HTTPS proxy, as `http://host:port` or `http://user:password@host:port`.
   * Requests to https hosts go through a CONNECT tunnel, so the proxy never sees their
   * content; plain http requests are sent to the proxy as they are.
   */
  readonly proxy?: string;
}

function decompress(res: IncomingMessage): Readable {
  switch (res.headers['content-encoding']) {
    case 'gzip':
      return res.pipe(createGunzip());
    case 'deflate':
      return res.pipe(createInflate());
    case 'br':
      return res.pipe(createBrotliDecompress());
    default:
      return res;
  }
}

function flattenHeaders(res: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(res.headers)) {
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return headers;
}

function parseProxy(proxy: string): URL {
  let url: URL;
  try {
    url = new URL(proxy);
  } catch (error) {
    throw new IgError('The proxy must be a URL like http://host:port', { cause: error });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new IgError('Only http and https proxies are supported');
  }
  return url;
}

function proxyAuthorization(proxy: URL): OutgoingHttpHeaders {
  if (proxy.username === '') {
    return {};
  }
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return { 'Proxy-Authorization': `Basic ${Buffer.from(credentials).toString('base64')}` };
}

function defaultPort(url: URL): number {
  if (url.port !== '') {
    return Number(url.port);
  }
  return url.protocol === 'https:' ? 443 : 80;
}

/** Opens a CONNECT tunnel through the proxy to `target` and returns the raw socket. */
function openTunnel(proxy: URL, target: URL): Promise<Socket> {
  const authority = `${target.hostname}:${String(defaultPort(target))}`;
  const send = proxy.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<Socket>((resolve, reject) => {
    const connect = send({
      method: 'CONNECT',
      hostname: proxy.hostname,
      port: defaultPort(proxy),
      path: authority,
      headers: { Host: authority, ...proxyAuthorization(proxy) },
    });
    connect.on('connect', (res: IncomingMessage, socket: Socket, head: Buffer) => {
      if (res.statusCode === 200 && !socket.destroyed) {
        // Bytes the proxy sent right after its answer belong to the tunnel.
        if (head.length > 0) {
          socket.unshift(head);
        }
        resolve(socket);
        return;
      }
      socket.destroy();
      reject(new IgError(`The proxy refused the tunnel (status ${String(res.statusCode)})`));
    });
    connect.on('error', (error: Error) => {
      reject(new IgError(`Could not reach the proxy at ${proxy.host}`, { cause: error }));
    });
    connect.end();
  });
}

/**
 * Hands the request the TLS connection opened inside one tunnel. Each request gets its own
 * agent with no pooling: Node's shared agent would let a proxied request reuse a direct
 * connection to the same host, which would skip the proxy.
 */
class TunnelAgent extends HttpsAgent {
  readonly #socket: TLSSocket;

  constructor(socket: TLSSocket) {
    super({ keepAlive: false });
    this.#socket = socket;
  }

  override createConnection(): TLSSocket {
    return this.#socket;
  }
}

/**
 * The default transport, over Node's http/https. Unlike global fetch it does not
 * inject browser `sec-fetch-*` headers, which the private API rejects. Sends
 * exactly the headers it is given and decompresses gzip/deflate/br responses.
 */
export class HttpsTransport implements HttpTransport {
  readonly #proxy: URL | undefined;

  constructor(options: HttpsTransportOptions = {}) {
    this.#proxy = options.proxy !== undefined ? parseProxy(options.proxy) : undefined;
  }

  async request(req: HttpRequest): Promise<HttpResponse> {
    const url = new URL(req.url);
    const proxy = this.#proxy;
    if (proxy === undefined) {
      return this.#send(req, url, {});
    }
    if (url.protocol === 'http:') {
      // A plain request to a proxy names the whole target URL as its path.
      return this.#send(req, proxy, {
        path: url.href,
        headers: { ...req.headers, ...proxyAuthorization(proxy) },
      });
    }
    const tunnel = await openTunnel(proxy, url);
    try {
      const tls = tlsConnect({
        socket: tunnel,
        servername: url.hostname,
        ALPNProtocols: ['http/1.1'],
      });
      return await this.#send(req, url, { agent: new TunnelAgent(tls) });
    } finally {
      // One tunnel per request: a kept-alive socket would hold the process open.
      tunnel.destroy();
    }
  }

  #send(
    req: HttpRequest,
    host: URL,
    overrides: {
      path?: string;
      headers?: OutgoingHttpHeaders;
      agent?: HttpsAgent;
    },
  ): Promise<HttpResponse> {
    return new Promise<HttpResponse>((resolve, reject) => {
      const send = host.protocol === 'http:' ? httpRequest : httpsRequest;
      const target = new URL(req.url);

      const clientRequest = send(
        {
          method: req.method,
          hostname: host.hostname,
          port: host.port === '' ? undefined : Number(host.port),
          path: `${target.pathname}${target.search}`,
          headers: req.headers,
          ...overrides,
        },
        (res) => {
          const chunks: Buffer[] = [];
          const stream = decompress(res);
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: flattenHeaders(res),
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          stream.on('error', (error: Error) => {
            reject(
              new IgError(`Failed to read response: ${req.method} ${req.url}`, { cause: error }),
            );
          });
        },
      );

      clientRequest.on('error', (error: Error) => {
        reject(new IgError(`HTTP request failed: ${req.method} ${req.url}`, { cause: error }));
      });

      if (req.body !== undefined) {
        clientRequest.write(req.body);
      }
      clientRequest.end();
    });
  }
}
