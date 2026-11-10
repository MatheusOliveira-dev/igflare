import { randomUUID } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';
import {
  threadSchema,
  directMessageSchema,
  directSendResultSchema,
  type Thread,
  type DirectMessage,
  type DirectSendResult,
} from '../../schemas/direct';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { parseSchemaList } from '../../schemas/parse-list';
import { ClientSchemaError } from '../../errors/api-errors';

export interface CursorOptions {
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly cursor?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The cursor a direct `inbox`/`thread` node carries, or undefined when exhausted. */
function nodeCursor(node: Record<string, unknown>): string | undefined {
  const hasOlder = node['has_older'];
  const cursor = node['oldest_cursor'];
  if (hasOlder === false || typeof cursor !== 'string' || cursor === '') {
    return undefined;
  }
  return cursor;
}

/** Fetches one page of an inbox-shaped endpoint (inbox, pending or spam). */
async function fetchInboxPage(
  client: PrivateClient,
  definition: EndpointDefinition,
  query: Record<string, string>,
): Promise<Page<Thread>> {
  const json = await client.request({
    method: definition.method,
    endpoint: definition.path,
    query,
  });
  const inbox = json['inbox'];
  if (!isRecord(inbox)) {
    throw new ClientSchemaError('direct inbox response did not include an inbox', json);
  }
  const items = parseSchemaList<Thread>(inbox['threads'], threadSchema, 'thread');
  const nextCursor = nodeCursor(inbox);
  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

function cursorQuery(options: CursorOptions): Record<string, string> {
  return options.cursor !== undefined ? { cursor: options.cursor } : {};
}

/** One page of the direct inbox (threads). Pass `cursor` to continue. */
export function getInbox(
  client: PrivateClient,
  options: CursorOptions = {},
): Promise<Page<Thread>> {
  return fetchInboxPage(client, endpoints.directInbox, cursorQuery(options));
}

/** Walks every thread in the inbox, yielding one at a time across pages. */
export function paginateInbox(client: PrivateClient): AsyncGenerator<Thread> {
  return paginate((cursor) => getInbox(client, cursor !== undefined ? { cursor } : {}));
}

/** One page of the pending inbox (message requests). Pass `cursor` to continue. */
export function getPendingInbox(
  client: PrivateClient,
  options: CursorOptions = {},
): Promise<Page<Thread>> {
  return fetchInboxPage(client, endpoints.directPendingInbox, {
    visual_message_return_type: 'unseen',
    persistentBadging: 'true',
    is_prefetching: 'false',
    request_session_id: client.session.device.requestId,
    ...cursorQuery(options),
  });
}

/** Walks every pending thread (message requests), one at a time across pages. */
export function paginatePendingInbox(client: PrivateClient): AsyncGenerator<Thread> {
  return paginate((cursor) => getPendingInbox(client, cursor !== undefined ? { cursor } : {}));
}

/** One page of the spam inbox (hidden requests). Pass `cursor` to continue. */
export function getSpamInbox(
  client: PrivateClient,
  options: CursorOptions = {},
): Promise<Page<Thread>> {
  return fetchInboxPage(client, endpoints.directSpamInbox, {
    visual_message_return_type: 'unseen',
    persistentBadging: 'true',
    is_prefetching: 'false',
    ...cursorQuery(options),
  });
}

/** Walks every spam thread (hidden requests), one at a time across pages. */
export function paginateSpamInbox(client: PrivateClient): AsyncGenerator<Thread> {
  return paginate((cursor) => getSpamInbox(client, cursor !== undefined ? { cursor } : {}));
}

/** One page of a thread's messages (newest first). Pass `cursor` to continue. */
export async function getThread(
  client: PrivateClient,
  threadId: string,
  options: CursorOptions = {},
): Promise<Page<DirectMessage>> {
  const json = await client.request({
    method: endpoints.directThread.method,
    endpoint: endpoints.directThread.path.replace('{thread_id}', threadId),
    query: { ...(options.cursor !== undefined ? { cursor: options.cursor } : {}) },
  });
  const thread = json['thread'];
  if (!isRecord(thread)) {
    throw new ClientSchemaError('direct thread response did not include a thread', json);
  }
  const items = parseSchemaList<DirectMessage>(thread['items'], directMessageSchema, 'message');
  const nextCursor = nodeCursor(thread);
  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

/** Walks every message in a thread, yielding one at a time across pages. */
export function paginateThread(
  client: PrivateClient,
  threadId: string,
): AsyncGenerator<DirectMessage> {
  return paginate((cursor) => getThread(client, threadId, cursor !== undefined ? { cursor } : {}));
}

/** Where a direct message is sent: an existing thread, or one or more user ids. */
export type SendTarget = { readonly threadId: string } | { readonly userIds: readonly string[] };

/** Sends a text message to a thread or to users, returning the send result. */
export async function sendText(
  client: PrivateClient,
  text: string,
  target: SendTarget,
): Promise<DirectSendResult> {
  const recipients =
    'threadId' in target
      ? { thread_ids: JSON.stringify([target.threadId]) }
      : { recipient_users: JSON.stringify([target.userIds]) };
  const json = await client.request({
    method: endpoints.directSendText.method,
    endpoint: endpoints.directSendText.path,
    payload: {
      action: 'send_item',
      text,
      client_context: randomUUID(),
      mutation_token: randomUUID(),
      ...recipients,
    },
  });
  const parsed = directSendResultSchema.safeParse(json['payload']);
  if (!parsed.success) {
    throw new ClientSchemaError('direct send response did not match the schema', json['payload'], {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
