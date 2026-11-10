import { describe, it, expect } from 'vitest';
import {
  approveThread,
  hideThread,
  setThreadTitle,
  addThreadUsers,
  muteThread,
  unmuteThread,
  deleteMessage,
  markMessageSeen,
  createGroupThread,
  findThreadByParticipants,
  searchRecipients,
} from './direct-manage';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const THREAD = '340282366841710301244259330242664032634';
const ITEM = '33099207189847068621439624456175616';

function clientReturning(body: unknown): { client: PrivateClient; transport: FakeTransport } {
  const transport = new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  }));
  const session = createSession({ auth: { userId: '10000000002' } });
  return { client: new PrivateClient({ transport, session }), transport };
}

function bodyText(request: HttpRequest | undefined): string {
  return typeof request?.body === 'string' ? request.body : '';
}

/** The fields of a plain form body. */
function formFields(request: HttpRequest | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(bodyText(request)));
}

/** The payload of a signed body, and whether the body really was signed. */
function signedFields(request: HttpRequest | undefined): Record<string, unknown> {
  const signed = new URLSearchParams(bodyText(request)).get('signed_body') ?? '';
  return JSON.parse(signed.slice(signed.indexOf('.') + 1)) as Record<string, unknown>;
}

const OK = { status: 'ok' };

describe('thread management (plain form body)', () => {
  it('approves a pending thread', async () => {
    const { client, transport } = clientReturning(OK);
    await approveThread(client, THREAD);
    const request = transport.requests[0];
    expect(request?.url).toContain(`/api/v1/direct_v2/threads/${THREAD}/approve/`);
    expect(request?.method).toBe('POST');
    expect(formFields(request)).toMatchObject({ filter: 'DEFAULT' });
    expect(bodyText(request)).not.toContain('signed_body');
  });

  it('hides a thread, optionally sending future requests to spam', async () => {
    const a = clientReturning(OK);
    await hideThread(a.client, THREAD);
    expect(a.transport.requests[0]?.url).toContain(`/threads/${THREAD}/hide/`);
    expect(formFields(a.transport.requests[0])['should_move_future_requests_to_spam']).toBe(
      'false',
    );

    const b = clientReturning(OK);
    await hideThread(b.client, THREAD, { moveToSpam: true });
    expect(formFields(b.transport.requests[0])['should_move_future_requests_to_spam']).toBe('true');
  });

  it('renames a group thread', async () => {
    const { client, transport } = clientReturning(OK);
    await setThreadTitle(client, THREAD, 'Equipe');
    expect(transport.requests[0]?.url).toContain(`/threads/${THREAD}/update_title/`);
    expect(formFields(transport.requests[0])['title']).toBe('Equipe');
  });

  it('adds users as a JSON array of string ids', async () => {
    const { client, transport } = clientReturning(OK);
    await addThreadUsers(client, THREAD, ['111', '222']);
    expect(transport.requests[0]?.url).toContain(`/threads/${THREAD}/add_user/`);
    expect(formFields(transport.requests[0])['user_ids']).toBe('["111","222"]');
  });

  it('marks a message seen with a matching client context and offline id', async () => {
    const { client, transport } = clientReturning(OK);
    await markMessageSeen(client, THREAD, ITEM);
    const request = transport.requests[0];
    expect(request?.url).toContain(`/threads/${THREAD}/items/${ITEM}/seen/`);
    const fields = formFields(request);
    expect(fields['action']).toBe('mark_seen');
    expect(fields['thread_id']).toBe(THREAD);
    expect(fields['client_context']).toMatch(/^68000\d{14}$/);
    expect(fields['offline_threading_id']).toBe(fields['client_context']);
  });
});

describe('thread management (signed body)', () => {
  it('mutes and unmutes a thread', async () => {
    const a = clientReturning(OK);
    await muteThread(a.client, THREAD);
    expect(a.transport.requests[0]?.url).toContain(`/threads/${THREAD}/mute/`);
    expect(bodyText(a.transport.requests[0])).toContain('signed_body');

    const b = clientReturning(OK);
    await unmuteThread(b.client, THREAD);
    expect(b.transport.requests[0]?.url).toContain(`/threads/${THREAD}/unmute/`);
  });

  it('deletes a message', async () => {
    const { client, transport } = clientReturning(OK);
    await deleteMessage(client, THREAD, ITEM);
    expect(transport.requests[0]?.url).toContain(`/threads/${THREAD}/items/${ITEM}/delete/`);
    expect(signedFields(transport.requests[0])['_uuid']).toBeTruthy();
  });
});

describe('createGroupThread', () => {
  it('creates a group, keeping 64-bit user ids exact in the JSON array', async () => {
    const { client, transport } = clientReturning({ status: 'ok', thread_id: THREAD });

    const id = await createGroupThread(client, ['10000000002', '9007199254740993'], 'Grupo');

    expect(id).toBe(THREAD);
    const fields = signedFields(transport.requests[0]);
    expect(transport.requests[0]?.url).toContain('/api/v1/direct_v2/create_group_thread/');
    expect(fields['recipient_users']).toBe('[10000000002,9007199254740993]');
    expect(fields['thread_title']).toBe('Grupo');
    expect(fields['_uid']).toBe('10000000002');
  });

  it('reads the id from a nested thread object', async () => {
    const { client } = clientReturning({ status: 'ok', thread: { thread_id: 'T9' } });
    expect(await createGroupThread(client, ['1', '2'])).toBe('T9');
  });

  it('needs at least two participants and numeric ids', async () => {
    const { client } = clientReturning(OK);
    await expect(createGroupThread(client, ['1'])).rejects.toBeInstanceOf(IgError);
    await expect(createGroupThread(client, ['1', 'abc'])).rejects.toBeInstanceOf(IgError);
  });

  it('throws a typed error when the response has no thread id', async () => {
    const { client } = clientReturning(OK);
    await expect(createGroupThread(client, ['1', '2'])).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('findThreadByParticipants', () => {
  it('returns the existing thread', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      thread: { thread_id: 't1', users: [{ pk: 1, username: 'a' }] },
    });

    const thread = await findThreadByParticipants(client, ['42']);

    const url = transport.requests[0]?.url ?? '';
    expect(url).toContain('/api/v1/direct_v2/threads/get_by_participants/');
    expect(decodeURIComponent(url)).toContain('recipient_users=[42]');
    expect(thread?.thread_id).toBe('t1');
  });

  it('returns undefined when there is none', async () => {
    const { client } = clientReturning({ status: 'ok' });
    expect(await findThreadByParticipants(client, ['42'])).toBeUndefined();
  });

  it('throws a typed error when the thread has the wrong shape', async () => {
    const { client } = clientReturning({ status: 'ok', thread: { thread_id: 5 } });
    await expect(findThreadByParticipants(client, ['42'])).rejects.toBeInstanceOf(
      ClientSchemaError,
    );
  });
});

describe('searchRecipients', () => {
  it('returns Instagram users and drops entries without a username', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      ranked_recipients: [
        { user: { pk: 1, username: 'alice' } },
        { user: { pk: 2, username: '' } }, // a Facebook suggestion
        { thread: { thread_id: 't' } },
      ],
    });

    const users = await searchRecipients(client, 'ali');

    const url = transport.requests[0]?.url ?? '';
    expect(url).toContain('/api/v1/direct_v2/ranked_recipients/');
    expect(url).toContain('query=ali');
    expect(url).toContain('mode=universal');
    expect(users.map((user) => user.username)).toEqual(['alice']);
  });

  it('throws when ranked_recipients is missing', async () => {
    const { client } = clientReturning(OK);
    await expect(searchRecipients(client, 'x')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('id validation', () => {
  it('rejects a thread id that is not numeric', async () => {
    const { client, transport } = clientReturning(OK);
    await expect(approveThread(client, '../evil')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });
});
