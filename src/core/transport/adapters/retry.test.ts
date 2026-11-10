import { describe, it, expect } from 'vitest';
import { RetryTransport } from './retry';
import type { HttpRequest, HttpResponse, HttpTransport } from '../http-transport';

const GET: HttpRequest = { method: 'GET', url: 'https://i.instagram.com/x/', headers: {} };
const POST: HttpRequest = { method: 'POST', url: 'https://i.instagram.com/x/', headers: {} };

function res(status: number, body = '{}', headers: Record<string, string> = {}): HttpResponse {
  return { status, headers, body };
}

/** Returns each queued outcome in turn (repeating the last), counting calls. */
class StubTransport implements HttpTransport {
  calls = 0;
  constructor(private readonly outcomes: (HttpResponse | Error)[]) {}
  request(): Promise<HttpResponse> {
    const index = Math.min(this.calls, this.outcomes.length - 1);
    const outcome = this.outcomes[index];
    this.calls += 1;
    if (outcome === undefined) {
      return Promise.reject(new Error('no outcome queued'));
    }
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }
}

function harness(outcomes: (HttpResponse | Error)[], options = {}) {
  const inner = new StubTransport(outcomes);
  const sleeps: number[] = [];
  const retry = new RetryTransport(inner, {
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
    ...options,
  });
  return { inner, sleeps, retry };
}

describe('RetryTransport', () => {
  it('retries a 429 and returns the next success', async () => {
    const { inner, retry } = harness([res(429), res(200, '{"ok":true}')]);
    const out = await retry.request(GET);
    expect(out.status).toBe(200);
    expect(inner.calls).toBe(2);
  });

  it('honors a Retry-After header instead of the backoff', async () => {
    const { sleeps, retry } = harness([res(429, '{}', { 'retry-after': '2' }), res(200)]);
    await retry.request(GET);
    expect(sleeps).toEqual([2000]);
  });

  it('uses jittered exponential backoff when there is no Retry-After', async () => {
    const { sleeps, retry } = harness([res(503), res(200)], { baseDelayMs: 1000 });
    await retry.request(GET);
    expect(sleeps).toEqual([500]); // floor(0.5 * min(max, 1000 * 2^0))
  });

  it('retries a thrown connection error', async () => {
    const { inner, retry } = harness([new Error('ECONNRESET'), res(200)]);
    const out = await retry.request(GET);
    expect(out.status).toBe(200);
    expect(inner.calls).toBe(2);
  });

  it('retries the "please wait" rate-limit body on a 200', async () => {
    const { inner, retry } = harness([
      res(200, '{"message":"Please wait a few minutes before you try again."}'),
      res(200, '{"ok":true}'),
    ]);
    await retry.request(GET);
    expect(inner.calls).toBe(2);
  });

  it('does not retry a 500 or other 4xx', async () => {
    const a = harness([res(500)]);
    expect((await a.retry.request(GET)).status).toBe(500);
    expect(a.inner.calls).toBe(1);

    const b = harness([res(404)]);
    expect((await b.retry.request(GET)).status).toBe(404);
    expect(b.inner.calls).toBe(1);
  });

  it('retries mutations (POST) the same as reads', async () => {
    const { inner, retry } = harness([res(429), res(200)]);
    await retry.request(POST);
    expect(inner.calls).toBe(2);
  });

  it('gives up after maxRetries and returns the last response', async () => {
    const { inner, retry } = harness([res(429)], { maxRetries: 2 });
    const out = await retry.request(GET);
    expect(out.status).toBe(429);
    expect(inner.calls).toBe(3); // first attempt + 2 retries
  });

  it('rethrows after exhausting retries on a persistent error', async () => {
    const { inner, retry } = harness([new Error('down')], { maxRetries: 1 });
    await expect(retry.request(GET)).rejects.toThrow('down');
    expect(inner.calls).toBe(2);
  });
});
