import { describe, it, expect } from 'vitest';
import { createNote, deleteNote, getNotes } from './notes';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError, IgApiError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function clientWith(handler: (req: HttpRequest) => HttpResponse): {
  client: PrivateClient;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(handler);
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

function variablesOf(request: HttpRequest | undefined): Record<string, unknown> {
  const body = typeof request?.body === 'string' ? request.body : '';
  return JSON.parse(new URLSearchParams(body).get('variables') ?? '{}') as Record<string, unknown>;
}

const TRAY_KEY = '1$xdt_get_inbox_tray_items(request:$request)';
const CREATE_KEY = '1$xdt_create_inbox_tray_item(request:$request)';
const DELETE_KEY = '1$xdt_delete_inbox_tray_item(item_id:$item_id)';

function noteItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inbox_tray_item_type: 'note',
    inbox_tray_item_id: '10000000000000001',
    note_dict: {
      note_id: '10000000000000001',
      text: 'hello there',
      audience: 0,
      note_style: 0,
      author_id: '10000000001',
      '1lcreated_at': 1700000000,
      '1lexpires_at': 1700086400,
      author: { id: '10000000001', username: 'fake_user' },
      ...overrides,
    },
  };
}

const tray = (...items: unknown[]): HttpResponse =>
  json({ data: { [TRAY_KEY]: { inbox_tray_items: items } } });

describe('getNotes', () => {
  it('asks for the inbox tray and reads the notes in it', async () => {
    const { client, transport } = clientWith(() => tray(noteItem()));

    const notes = await getNotes(client);

    const request = transport.requests[0];
    expect(request?.url).toBe('https://i.instagram.com/graphql_www');
    expect(request?.headers['X-FB-Friendly-Name']).toBe('InboxTrayRequest');
    expect(request?.headers['X-Root-Field-Name']).toBe('xdt_get_inbox_tray_items');
    expect(variablesOf(request)).toMatchObject({
      request: { inbox_tray_item_ids_on_client: [] },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      note_id: '10000000000000001',
      text: 'hello there',
      audience: 0,
      created_at: 1700000000,
      expires_at: 1700086400,
    });
    expect(notes[0]?.author?.pk).toBe('10000000001');
    expect(notes[0]?.author?.username).toBe('fake_user');
  });

  it('skips tray items that are not notes', async () => {
    const { client } = clientWith(() =>
      tray({ inbox_tray_item_type: 'story' }, noteItem(), { note_dict: null }),
    );
    expect(await getNotes(client)).toHaveLength(1);
  });

  it('gives a note that carries no end time a day from its start', async () => {
    const { client } = clientWith(() =>
      tray(noteItem({ '1lexpires_at': undefined, '1lcreated_at': 1700000000 })),
    );
    expect((await getNotes(client))[0]?.expires_at).toBe(1700086400);
  });

  it('takes the author from the avatar next to a note that does not name it', async () => {
    const item = {
      ...noteItem({ author: undefined }),
      pog_info: { pog_users: [{ id: '10000000001', username: 'fake_user' }] },
    };
    const { client } = clientWith(() => tray(item));
    expect((await getNotes(client))[0]?.author?.username).toBe('fake_user');
  });

  it('is empty when the tray holds no notes', async () => {
    const { client } = clientWith(() => tray());
    expect(await getNotes(client)).toEqual([]);
  });

  it('throws a typed error carrying the server message when the query is refused', async () => {
    const { client } = clientWith(() =>
      json({ data: null, errors: [{ message: 'missing_required_variable_value' }] }),
    );
    const error = await getNotes(client).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IgApiError);
    expect((error as IgApiError).message).toContain('missing_required_variable_value');
  });

  it('throws when the tray has no items list or a note does not match the schema', async () => {
    const noList = clientWith(() => json({ data: { [TRAY_KEY]: {} } }));
    await expect(getNotes(noList.client)).rejects.toBeInstanceOf(ClientSchemaError);
    const bad = clientWith(() => tray(noteItem({ text: 42 })));
    await expect(getNotes(bad.client)).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('createNote', () => {
  const created = (text = 'hi'): HttpResponse =>
    json({
      data: { [CREATE_KEY]: { success: true, inbox_tray_item: noteItem({ text }) } },
    });

  it('posts a note for mutual followers by default', async () => {
    const { client, transport } = clientWith(() => created());

    const note = await createNote(client, '  hi  ');

    const request = transport.requests[0];
    expect(request?.headers['X-FB-Friendly-Name']).toBe('CreateInboxTrayItemRequest');
    expect(request?.headers['X-Root-Field-Name']).toBe('xdt_create_inbox_tray_item');
    expect(variablesOf(request)).toMatchObject({
      request: {
        inbox_tray_item_type: 'note',
        audience: 0,
        additional_params: { note_create_params: { text: 'hi', note_style: 0 } },
      },
    });
    expect(note.text).toBe('hi');
  });

  it('can post for close friends only', async () => {
    const { client, transport } = clientWith(() => created());
    await createNote(client, 'hi', { audience: 'closeFriends' });
    expect(variablesOf(transport.requests[0])).toMatchObject({ request: { audience: 1 } });
  });

  it('counts characters, not bytes, against the 60 limit', async () => {
    const { client, transport } = clientWith(() => created());
    await createNote(client, '\u{1F600}'.repeat(60));
    expect(transport.requests).toHaveLength(1);
  });

  it('refuses an empty note or one over 60 characters, before any request', async () => {
    const { client, transport } = clientWith(() => created());
    await expect(createNote(client, '   ')).rejects.toBeInstanceOf(IgError);
    await expect(createNote(client, 'x'.repeat(61))).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when the server does not report success', async () => {
    const { client } = clientWith(() =>
      json({ data: { [CREATE_KEY]: { success: false, inbox_tray_item: null } } }),
    );
    await expect(createNote(client, 'hi')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('throws a typed error when the query is refused', async () => {
    const { client } = clientWith(() => json({ errors: [{ message: 'nope' }] }));
    await expect(createNote(client, 'hi')).rejects.toBeInstanceOf(IgApiError);
  });
});

describe('deleteNote', () => {
  it('deletes a note by its id', async () => {
    const { client, transport } = clientWith(() => json({ data: { [DELETE_KEY]: true } }));

    await deleteNote(client, '10000000000000001');

    const request = transport.requests[0];
    expect(request?.headers['X-FB-Friendly-Name']).toBe('DeleteInboxTrayItemRequest');
    expect(request?.headers['X-Root-Field-Name']).toBe('xdt_delete_inbox_tray_item');
    expect(variablesOf(request)).toEqual({ item_id: '10000000000000001' });
  });

  it('refuses an id that is not numeric, before any request', async () => {
    const { client, transport } = clientWith(() => json({ data: { [DELETE_KEY]: true } }));
    await expect(deleteNote(client, '1/../x')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws a typed error when the deletion is refused', async () => {
    const { client } = clientWith(() => json({ errors: [{ message: 'nope' }] }));
    await expect(deleteNote(client, '5')).rejects.toBeInstanceOf(IgApiError);
  });
});
