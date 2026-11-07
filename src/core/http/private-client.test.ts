import { describe, it, expect } from 'vitest';
import { PrivateClient } from './private-client';
import { FakeTransport } from '../transport/adapters/fake';
import { MemorySessionStore } from '../session/adapters/memory';
import { createSession } from '../session/session';
import { LoginRequiredError } from '../../errors/api-errors';

function ok(body: unknown, headers: Record<string, string> = {}): FakeTransport {
  return new FakeTransport(() => ({
    status: 200,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

describe('PrivateClient', () => {
  it('builds a request, sends it and returns parsed json', async () => {
    const transport = ok({ status: 'ok', user: 1 });
    const client = new PrivateClient({ transport, session: createSession() });
    const json = await client.request({ method: 'GET', endpoint: 'feed/timeline/' });
    expect(json.status).toBe('ok');
    expect(transport.requests[0]?.url).toContain('/api/v1/feed/timeline/');
  });

  it('updates the session from response headers', async () => {
    const transport = ok({ status: 'ok' }, { 'ig-set-x-mid': 'MID9' });
    const client = new PrivateClient({ transport, session: createSession() });
    await client.request({ method: 'GET', endpoint: 'x/' });
    expect(client.session.auth.mid).toBe('MID9');
  });

  it('throws the typed error on a failure response', async () => {
    const failing = new FakeTransport(() => ({
      status: 403,
      headers: {},
      body: JSON.stringify({ message: 'login_required' }),
    }));
    const client = new PrivateClient({ transport: failing, session: createSession() });
    await expect(client.request({ method: 'GET', endpoint: 'x/' })).rejects.toBeInstanceOf(
      LoginRequiredError,
    );
  });

  it('persists the session to the store after a request', async () => {
    const store = new MemorySessionStore();
    const transport = ok({ status: 'ok' }, { 'ig-set-x-mid': 'MID3' });
    const client = new PrivateClient({ transport, store, session: createSession() });
    await client.request({ method: 'GET', endpoint: 'x/' });
    const saved = await store.load();
    expect(saved?.auth.mid).toBe('MID3');
  });

  it('loads an existing session via fromStore', async () => {
    const store = new MemorySessionStore(createSession({ auth: { userId: '77' } }));
    const client = await PrivateClient.fromStore(store, { transport: ok({}) });
    expect(client.session.auth.userId).toBe('77');
  });

  it('creates a fresh session via fromStore when the store is empty', async () => {
    const client = await PrivateClient.fromStore(new MemorySessionStore());
    expect(client.session.device.uuid).toMatch(/^[0-9a-f-]{36}$/);
  });
});
