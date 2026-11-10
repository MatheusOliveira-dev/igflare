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

describe('PrivateClient session expiry', () => {
  const EXPIRED = {
    status: 403,
    headers: {},
    body: JSON.stringify({ message: 'login_required', status: 'fail' }),
  };
  const OK = { status: 200, headers: {}, body: JSON.stringify({ status: 'ok' }) };

  /** A transport that rejects with login_required until `fresh` is flipped on. */
  function expiring(): { transport: FakeTransport; fresh: { value: boolean } } {
    const fresh = { value: false };
    const transport = new FakeTransport(() => (fresh.value ? OK : EXPIRED));
    return { transport, fresh };
  }

  it('re-authenticates and repeats the rejected request once', async () => {
    const { transport, fresh } = expiring();
    let hookCalls = 0;
    const client = new PrivateClient({
      transport,
      session: createSession(),
      onSessionExpired: () => {
        hookCalls += 1;
        fresh.value = true;
        return Promise.resolve();
      },
    });

    const json = await client.request({ method: 'GET', endpoint: 'x/' });

    expect(json.status).toBe('ok');
    expect(hookCalls).toBe(1);
    expect(transport.requests).toHaveLength(2);
  });

  it('throws the typed error when no hook is set', async () => {
    const { transport } = expiring();
    const client = new PrivateClient({ transport, session: createSession() });
    await expect(client.request({ method: 'GET', endpoint: 'x/' })).rejects.toBeInstanceOf(
      LoginRequiredError,
    );
  });

  it('does not loop when the repeated request is rejected again', async () => {
    const { transport } = expiring();
    let hookCalls = 0;
    const client = new PrivateClient({
      transport,
      session: createSession(),
      onSessionExpired: () => {
        hookCalls += 1;
        return Promise.resolve(); // the hook "succeeds" but the session stays expired
      },
    });

    await expect(client.request({ method: 'GET', endpoint: 'x/' })).rejects.toBeInstanceOf(
      LoginRequiredError,
    );
    expect(hookCalls).toBe(1);
    expect(transport.requests).toHaveLength(2);
  });

  it('shares one re-authentication between requests that fail together', async () => {
    const { transport, fresh } = expiring();
    let hookCalls = 0;
    const client = new PrivateClient({
      transport,
      session: createSession(),
      onSessionExpired: async () => {
        hookCalls += 1;
        await Promise.resolve();
        fresh.value = true;
      },
    });

    const results = await Promise.all([
      client.request({ method: 'GET', endpoint: 'a/' }),
      client.request({ method: 'GET', endpoint: 'b/' }),
      client.request({ method: 'GET', endpoint: 'c/' }),
    ]);

    expect(results.map((json) => json.status)).toEqual(['ok', 'ok', 'ok']);
    expect(hookCalls).toBe(1);
  });

  it('does not re-enter the hook for requests the hook itself makes', async () => {
    const { transport } = expiring();
    let hookCalls = 0;
    const client: PrivateClient = new PrivateClient({
      transport,
      session: createSession(),
      onSessionExpired: async () => {
        hookCalls += 1;
        // A login-like request made inside the hook is also rejected; it must
        // surface to the hook instead of recursing into another re-authentication.
        await client.request({ method: 'GET', endpoint: 'inside/' }).catch(() => undefined);
      },
    });

    await expect(client.request({ method: 'GET', endpoint: 'x/' })).rejects.toBeInstanceOf(
      LoginRequiredError,
    );
    expect(hookCalls).toBe(1);
  });

  it('propagates a failure of the hook itself', async () => {
    const { transport } = expiring();
    const client = new PrivateClient({
      transport,
      session: createSession(),
      onSessionExpired: () => Promise.reject(new Error('relogin failed')),
    });
    await expect(client.request({ method: 'GET', endpoint: 'x/' })).rejects.toThrow(
      'relogin failed',
    );
  });

  it('allows a later expiry to re-authenticate again', async () => {
    const { transport, fresh } = expiring();
    let hookCalls = 0;
    const client = new PrivateClient({
      transport,
      session: createSession(),
      onSessionExpired: () => {
        hookCalls += 1;
        fresh.value = true;
        return Promise.resolve();
      },
    });

    await client.request({ method: 'GET', endpoint: 'x/' });
    fresh.value = false; // the session expires again
    await client.request({ method: 'GET', endpoint: 'y/' });

    expect(hookCalls).toBe(2);
  });
});
