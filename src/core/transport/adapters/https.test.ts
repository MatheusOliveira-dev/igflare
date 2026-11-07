import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
