import { persistedQueries } from '../../generated/persisted-queries';
import type { PrivateClient } from '../../core/http/private-client';
import { pandoRequest, pandoRoot } from '../../core/http/pando';
import { isRecord } from '../../core/guards';
import { noteSchema, type Note } from '../../schemas/note';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

// The persisted-query ids belong to the app build this client reports (see
// manifest/persisted-queries.json). A new build can change them, and the symptom is a
// typed error from these calls.
const INBOX_TRAY = persistedQueries.inboxTray;
const CREATE = persistedQueries.createInboxTrayItem;
const DELETE = persistedQueries.deleteInboxTrayItem;

/** Who may see a note. */
export type NoteAudience = 'mutual' | 'closeFriends';

const MAX_TEXT = 60;

/** A note lasts a day; the answer for the account's own note leaves the end time out. */
const NOTE_LIFETIME_SECONDS = 86_400;

/** The author of a note, from the note itself or from the avatar next to it. */
function authorOf(item: Record<string, unknown>, note: Record<string, unknown>): unknown {
  if (isRecord(note['author'])) {
    return note['author'];
  }
  const pog = item['pog_info'];
  const users = isRecord(pog) ? pog['pog_users'] : undefined;
  const list: unknown[] = Array.isArray(users) ? (users as unknown[]) : [];
  const id = note['author_id'];
  const wanted = typeof id === 'string' || typeof id === 'number' ? String(id) : '';
  return list.find((user) => isRecord(user) && String(user['id'] ?? user['pk']) === wanted);
}

/** One inbox tray item holding a note, as a `Note`. */
function noteOf(item: Record<string, unknown>): Note | undefined {
  const note = item['note_dict'];
  if (!isRecord(note)) {
    return undefined;
  }
  // The server marks its 64-bit fields with a "1l" prefix on the key.
  const created = note['1lcreated_at'] ?? note['created_at'];
  const expires =
    note['1lexpires_at'] ??
    note['expires_at'] ??
    (typeof created === 'number' ? created + NOTE_LIFETIME_SECONDS : undefined);
  const author = authorOf(item, note);
  const parsed = noteSchema.safeParse({
    ...note,
    note_id: note['note_id'] ?? item['inbox_tray_item_id'],
    created_at: created,
    expires_at: expires,
    ...(author !== undefined
      ? { author: isRecord(author) ? { ...author, pk: author['pk'] ?? author['id'] } : author }
      : {}),
  });
  if (!parsed.success) {
    throw new ClientSchemaError('a note did not match the schema', note, { cause: parsed.error });
  }
  return parsed.data;
}

/** The notes in the inbox tray: the account's own and those of followed accounts. */
export async function getNotes(client: PrivateClient): Promise<Note[]> {
  const json = await pandoRequest(client, {
    friendlyName: INBOX_TRAY.operation,
    docId: INBOX_TRAY.docId,
    rootField: 'xdt_get_inbox_tray_items',
    variables: {
      should_fetch_friend_map_user: true,
      should_fetch_friend_map_entrypoint: false,
      should_fetch_comment_info: false,
      request: {
        include_quicksnap_pog: false,
        include_friend_map_pog: false,
        inbox_tray_item_ids_on_client: [],
      },
      is_saved_media_on_map_enabled: false,
      is_location_likes_v2_enabled: true,
    },
  });
  const root = pandoRoot(json, 'xdt_get_inbox_tray_items', 'notes request');
  const items = isRecord(root) ? root['inbox_tray_items'] : undefined;
  if (!Array.isArray(items)) {
    throw new ClientSchemaError('the inbox tray did not include an items list', json);
  }
  return (items as unknown[]).flatMap((item) => {
    const note = isRecord(item) ? noteOf(item) : undefined;
    return note !== undefined ? [note] : [];
  });
}

/** Options for a note. */
export interface CreateNoteOptions {
  /** Who may see it. Defaults to mutual followers. */
  readonly audience?: NoteAudience;
}

/** Posts a note (a short text, up to 60 characters) and returns it. */
export async function createNote(
  client: PrivateClient,
  text: string,
  options: CreateNoteOptions = {},
): Promise<Note> {
  const trimmed = text.trim();
  if (trimmed === '' || Array.from(trimmed).length > MAX_TEXT) {
    throw new IgError(`A note is 1 to ${String(MAX_TEXT)} characters`);
  }
  const json = await pandoRequest(client, {
    friendlyName: CREATE.operation,
    docId: CREATE.docId,
    rootField: 'xdt_create_inbox_tray_item',
    variables: {
      should_fetch_content_note_stack_video_info: false,
      request: {
        inbox_tray_item_type: 'note',
        audience: options.audience === 'closeFriends' ? 1 : 0,
        additional_params: {
          note_create_params: { text: trimmed, note_style: 0, note_create_info: null },
        },
      },
    },
  });
  const root = pandoRoot(json, 'xdt_create_inbox_tray_item', 'new note');
  const item = isRecord(root) ? root['inbox_tray_item'] : undefined;
  const note =
    root !== undefined && isRecord(root) && root['success'] === true && isRecord(item)
      ? noteOf(item)
      : undefined;
  if (note === undefined) {
    throw new ClientSchemaError('the server did not create the note', json);
  }
  return note;
}

/** Deletes a note by its id (the `note_id` of a note the account posted). */
export async function deleteNote(client: PrivateClient, noteId: string): Promise<void> {
  if (!/^\d+$/.test(noteId)) {
    throw new IgError('A note id must be numeric');
  }
  const json = await pandoRequest(client, {
    friendlyName: DELETE.operation,
    docId: DELETE.docId,
    rootField: 'xdt_delete_inbox_tray_item',
    variables: { item_id: noteId },
  });
  pandoRoot(json, 'xdt_delete_inbox_tray_item', 'note deletion');
}
