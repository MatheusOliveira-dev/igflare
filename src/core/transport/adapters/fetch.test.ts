import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FetchTransport } from './fetch';
import { IgError } from '../../../errors/ig-error';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      res.setHeader('x-echo-method', req.method ?? '');
      res.setHeader('content-type', 'application/json');
      res.statusCode = 201;
      res.end(
        JSON.stringify({ method: req.method, body, auth: req.headers.authorization ?? null }),
      );
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${String(port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('FetchTransport', () => {
  it('sends method, headers and body and reads the response back', async () => {
    const response = await new FetchTransport().request({
      method: 'POST',
      url: `${baseUrl}/api/v1/accounts/login/`,
      headers: { Authorization: 'Bearer token' },
      body: 'signed_body=SIGNATURE.x',
    });

    expect(response.status).toBe(201);
    expect(response.headers['x-echo-method']).toBe('POST');
    const parsed = JSON.parse(response.body) as { method: string; body: string; auth: string };
    expect(parsed.method).toBe('POST');
    expect(parsed.body).toBe('signed_body=SIGNATURE.x');
    expect(parsed.auth).toBe('Bearer token');
  });

  it('wraps a network failure in a typed error', async () => {
    await expect(
      new FetchTransport().request({ method: 'GET', url: 'http://127.0.0.1:1/api', headers: {} }),
    ).rejects.toBeInstanceOf(IgError);
  });
});
