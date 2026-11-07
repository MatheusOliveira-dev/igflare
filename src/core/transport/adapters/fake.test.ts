import { describe, it, expect } from 'vitest';
import { FakeTransport } from './fake';

describe('FakeTransport', () => {
  it('returns the handler response and records the request', async () => {
    const transport = new FakeTransport((req) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: req.url }),
    }));

    const response = await transport.request({
      method: 'GET',
      url: 'https://i.instagram.com/api/v1/feed/timeline/',
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/feed/timeline/');
  });

  it('supports an async handler', async () => {
    const transport = new FakeTransport(() =>
      Promise.resolve({ status: 204, headers: {}, body: '' }),
    );
    const response = await transport.request({ method: 'POST', url: 'https://x/api', headers: {} });
    expect(response.status).toBe(204);
  });
});
