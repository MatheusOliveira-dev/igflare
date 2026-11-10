import { describe, it, expect } from 'vitest';
import { getInbox, paginateInbox, getThread, sendText } from './direct';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';

function clientReturning(body: unknown): { client: PrivateClient; transport: FakeTransport } {
  const transport = new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  }));
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

function signedPayload(body: string | Uint8Array | undefined): Record<string, unknown> {
  const form = new URLSearchParams(typeof body === 'string' ? body : '');
  const signed = form.get('signed_body') ?? '';
  return JSON.parse(signed.slice(signed.indexOf('.') + 1)) as Record<string, unknown>;
}

describe('getInbox', () => {
  it('parses threads and the cursor when more pages exist', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      inbox: {
        threads: [{ thread_id: 't1', users: [{ pk: 1, username: 'a' }] }],
        has_older: true,
        oldest_cursor: 'c1',
      },
    });

    const page = await getInbox(client);

    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/direct_v2/inbox/');
    expect(page.items[0]?.thread_id).toBe('t1');
    expect(page.nextCursor).toBe('c1');
  });

  it('passes the cursor and stops when has_older is false', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      inbox: { threads: [], has_older: false, oldest_cursor: 'c2' },
    });

    const page = await getInbox(client, { cursor: 'c1' });

    expect(transport.requests[0]?.url).toContain('?cursor=c1');
    expect(page.nextCursor).toBeUndefined();
  });

  it('throws when the response has no inbox', async () => {
    const { client } = clientReturning({ status: 'ok' });
    await expect(getInbox(client)).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('walks the inbox across pages with the iterator', async () => {
    let call = 0;
    const transport = new FakeTransport(() => {
      call += 1;
      const inbox =
        call === 1
          ? { threads: [{ thread_id: 't1' }], has_older: true, oldest_cursor: 'c1' }
          : { threads: [{ thread_id: 't2' }], has_older: false };
      return { status: 200, headers: {}, body: JSON.stringify({ status: 'ok', inbox }) };
    });
    const client = new PrivateClient({ transport, session: createSession() });

    const ids: (string | undefined)[] = [];
    for await (const thread of paginateInbox(client)) {
      ids.push(thread.thread_id);
    }
    expect(ids).toEqual(['t1', 't2']);
  });
});

describe('getThread', () => {
  it('parses a thread message page from the thread node', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      thread: {
        items: [{ item_id: 'm1', item_type: 'text', text: 'hi', user_id: 9 }],
        has_older: true,
        oldest_cursor: 'tc1',
      },
    });

    const page = await getThread(client, 't1');

    expect(transport.requests[0]?.url).toContain('/api/v1/direct_v2/threads/t1/');
    expect(page.items[0]?.text).toBe('hi');
    expect(page.items[0]?.user_id).toBe('9');
    expect(page.nextCursor).toBe('tc1');
  });

  it('throws a typed schema error on a malformed message', async () => {
    const { client } = clientReturning({ status: 'ok', thread: { items: [{ item_id: 5 }] } });
    await expect(getThread(client, 't1')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('sendText', () => {
  it('sends to a thread and returns the parsed result', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      payload: { item_id: 'i1', thread_id: 't1', timestamp: '123' },
    });

    const result = await sendText(client, 'hello', { threadId: 't1' });

    expect(transport.requests[0]?.url).toContain('/api/v1/direct_v2/threads/broadcast/text/');
    const payload = signedPayload(transport.requests[0]?.body);
    expect(payload['text']).toBe('hello');
    expect(payload['thread_ids']).toBe('["t1"]');
    expect(payload['client_context']).toMatch(/[0-9a-f-]{36}/);
    expect(result.item_id).toBe('i1');
  });

  it('sends to users with a nested recipient_users array', async () => {
    const { client, transport } = clientReturning({ status: 'ok', payload: { item_id: 'i2' } });
    await sendText(client, 'hey', { userIds: ['42', '43'] });
    const payload = signedPayload(transport.requests[0]?.body);
    expect(payload['recipient_users']).toBe('[["42","43"]]');
  });
});
