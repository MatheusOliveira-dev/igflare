import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { HttpsTransport } from './https';
import { IgError } from '../../../errors/ig-error';

let server: Server;
let baseUrl: string;
let lastHeaders: Record<string, string | string[] | undefined> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    lastHeaders = req.headers;
    if (req.url === '/gzip') {
      res.setHeader('content-encoding', 'gzip');
      res.setHeader('content-type', 'application/json');
      res.end(gzipSync(Buffer.from(JSON.stringify({ zipped: true }))));
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      res.statusCode = 201;
      res.end(JSON.stringify({ method: req.method, body }));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('HttpsTransport', () => {
  it('sends only the given headers, without any sec-fetch header', async () => {
    const response = await new HttpsTransport().request({
      method: 'POST',
      url: `${baseUrl}/`,
      headers: { 'x-ig-app-id': '567067343352427' },
      body: 'signed_body=SIGNATURE.x',
    });

    expect(response.status).toBe(201);
    expect(JSON.parse(response.body)).toEqual({ method: 'POST', body: 'signed_body=SIGNATURE.x' });
    expect(lastHeaders['x-ig-app-id']).toBe('567067343352427');
    expect(lastHeaders['sec-fetch-mode']).toBeUndefined();
    expect(lastHeaders['sec-fetch-site']).toBeUndefined();
  });

  it('decompresses a gzip response', async () => {
    const response = await new HttpsTransport().request({
      method: 'GET',
      url: `${baseUrl}/gzip`,
      headers: {},
    });
    expect(JSON.parse(response.body)).toEqual({ zipped: true });
  });

  it('wraps a connection failure in a typed error', async () => {
    await expect(
      new HttpsTransport().request({ method: 'GET', url: 'http://127.0.0.1:1/x', headers: {} }),
    ).rejects.toBeInstanceOf(IgError);
  });
});

describe('HttpsTransport through a proxy', () => {
  let proxy: Server;
  let proxyUrl: string;
  let seen: { method?: string | undefined; url?: string | undefined; auth?: string | undefined }[] =
    [];
  let connectStatus = 407;

  beforeAll(async () => {
    proxy = createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, auth: req.headers['proxy-authorization'] });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ forwarded: req.url }));
    });
    proxy.on('connect', (req: IncomingMessage, socket: Socket) => {
      seen.push({ method: req.method, url: req.url, auth: req.headers['proxy-authorization'] });
      if (connectStatus !== 200) {
        socket.end(`HTTP/1.1 ${String(connectStatus)} Test\r\n\r\n`);
        return;
      }
      // A tunnel that answers with bytes that are not TLS, as a broken proxy would.
      socket.write('HTTP/1.1 200 Connection established\r\n\r\n');
      socket.write('not a tls server\r\n\r\n');
      setTimeout(() => socket.destroy(), 200);
    });
    await new Promise<void>((resolve) => {
      proxy.listen(0, '127.0.0.1', resolve);
    });
    proxyUrl = `http://127.0.0.1:${String((proxy.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      proxy.close(() => {
        resolve();
      });
    });
  });

  it('sends a plain http request to the proxy with the whole URL and the credentials', async () => {
    seen = [];
    const withAuth = new URL(proxyUrl);
    withAuth.username = 'user%40x';
    withAuth.password = 'p%3Ass';
    // The proxy is a plain http server, so it doubles as the plain http target.
    const target = `${proxyUrl}/path?q=1`;
    const response = await new HttpsTransport({ proxy: withAuth.href }).request({
      method: 'GET',
      url: target,
      headers: {},
    });
    expect(JSON.parse(response.body)).toEqual({ forwarded: target });
    expect(seen[0]?.auth).toBe(`Basic ${Buffer.from('user@x:p:ss').toString('base64')}`);
  });

  it('opens a CONNECT tunnel to an https host and reports a refused one', async () => {
    seen = [];
    connectStatus = 407;
    const transport = new HttpsTransport({ proxy: proxyUrl });
    await expect(
      transport.request({ method: 'GET', url: 'https://i.instagram.com/api/v1/x/', headers: {} }),
    ).rejects.toThrow('The proxy refused the tunnel (status 407)');
    expect(seen[0]).toMatchObject({ method: 'CONNECT', url: 'i.instagram.com:443' });
    expect(seen[0]?.auth).toBeUndefined();
  });

  it('starts TLS inside an accepted tunnel', async () => {
    seen = [];
    connectStatus = 200;
    const transport = new HttpsTransport({ proxy: proxyUrl });
    // The test proxy answers garbage inside the tunnel, so the handshake fails as a typed error.
    await expect(
      transport.request({ method: 'GET', url: 'https://i.instagram.com:8443/x', headers: {} }),
    ).rejects.toBeInstanceOf(IgError);
    expect(seen[0]).toMatchObject({ method: 'CONNECT', url: 'i.instagram.com:8443' });
  });

  it('refuses a proxy that is not an http or https URL', () => {
    expect(() => new HttpsTransport({ proxy: 'not a url' })).toThrow(IgError);
    expect(() => new HttpsTransport({ proxy: 'socks5://127.0.0.1:1080' })).toThrow(
      'Only http and https proxies are supported',
    );
  });

  it('reports a proxy that cannot be reached', async () => {
    const transport = new HttpsTransport({ proxy: proxyUrl.replace(/:\d+$/, ':1') });
    await expect(
      transport.request({ method: 'GET', url: 'https://i.instagram.com/', headers: {} }),
    ).rejects.toThrow('Could not reach the proxy');
  });
});
