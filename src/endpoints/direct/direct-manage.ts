import { randomUUID } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';
import { threadSchema, type Thread } from '../../schemas/direct';
import { userSchema, type User } from '../../schemas/user';
import { parseSchemaList } from '../../schemas/parse-list';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { mutationToken, numericIdArray } from './direct-wire';
import { checkedId, checkedIds } from '../../core/ids';
import { isRecord } from '../../core/guards';

function threadPath(definition: EndpointDefinition, threadId: string): string {
  return definition.path.replace('{thread_id}', checkedId(threadId, 'A thread id'));
}

/**
 * Posts a thread action. Most of them take plain form fields. Delete, mute and
 * group creation take the signed body, mirroring what the app sends for each.
 */
async function postAction(
  client: PrivateClient,
  definition: EndpointDefinition,
  endpoint: string,
  payload: Record<string, unknown>,
  form: boolean,
): Promise<Record<string, unknown>> {
  return client.request({
    method: definition.method,
    endpoint,
    payload,
    withDefaultData: false,
    ...(form ? { encoding: 'form' as const } : {}),
  });
}

function uuid(client: PrivateClient): string {
  return client.session.device.uuid;
}

/** Approves a pending thread (a message request), moving it to the main inbox. */
export async function approveThread(client: PrivateClient, threadId: string): Promise<void> {
  await postAction(
    client,
    endpoints.directThreadApprove,
    threadPath(endpoints.directThreadApprove, threadId),
    { filter: 'DEFAULT', _uuid: uuid(client) },
    true,
  );
}

export interface HideThreadOptions {
  /** Also send this person's future requests to the spam folder. */
  readonly moveToSpam?: boolean;
}

/** Hides (deletes from the inbox) a thread. */
export async function hideThread(
  client: PrivateClient,
  threadId: string,
  options: HideThreadOptions = {},
): Promise<void> {
  await postAction(
    client,
    endpoints.directThreadHide,
    threadPath(endpoints.directThreadHide, threadId),
    {
      should_move_future_requests_to_spam: options.moveToSpam === true ? 'true' : 'false',
      _uuid: uuid(client),
    },
    true,
  );
}

/** Renames a group thread. */
export async function setThreadTitle(
  client: PrivateClient,
  threadId: string,
  title: string,
): Promise<void> {
  await postAction(
    client,
    endpoints.directThreadUpdateTitle,
    threadPath(endpoints.directThreadUpdateTitle, threadId),
    { _uuid: uuid(client), title },
    true,
  );
}

/** Adds users to a group thread. */
export async function addThreadUsers(
  client: PrivateClient,
  threadId: string,
  userIds: readonly string[],
): Promise<void> {
  checkedIds(userIds, 'User ids');
  await postAction(
    client,
    endpoints.directThreadAddUser,
    threadPath(endpoints.directThreadAddUser, threadId),
    { _uuid: uuid(client), user_ids: JSON.stringify(userIds) },
    true,
  );
}

/** Mutes a thread's notifications. */
export async function muteThread(client: PrivateClient, threadId: string): Promise<void> {
  await postAction(
    client,
    endpoints.directThreadMute,
    threadPath(endpoints.directThreadMute, threadId),
    { _uuid: uuid(client) },
    false,
  );
}

/** Unmutes a thread's notifications. */
export async function unmuteThread(client: PrivateClient, threadId: string): Promise<void> {
  await postAction(
    client,
    endpoints.directThreadUnmute,
    threadPath(endpoints.directThreadUnmute, threadId),
    { _uuid: uuid(client) },
    false,
  );
}

function messagePath(definition: EndpointDefinition, threadId: string, itemId: string): string {
  return definition.path
    .replace('{thread_id}', checkedId(threadId, 'A thread id'))
    .replace('{item_id}', checkedId(itemId, 'A message id'));
}

/** Deletes one of the account's messages from a thread (unsends it). */
export async function deleteMessage(
  client: PrivateClient,
  threadId: string,
  itemId: string,
): Promise<void> {
  await postAction(
    client,
    endpoints.directMessageDelete,
    messagePath(endpoints.directMessageDelete, threadId, itemId),
    { _uuid: uuid(client) },
    false,
  );
}

/** Marks a message, and the thread up to it, as seen. */
export async function markMessageSeen(
  client: PrivateClient,
  threadId: string,
  itemId: string,
): Promise<void> {
  const token = mutationToken();
  await postAction(
    client,
    endpoints.directMessageSeen,
    messagePath(endpoints.directMessageSeen, threadId, itemId),
    {
      thread_id: threadId,
      action: 'mark_seen',
      client_context: token,
      _uuid: uuid(client),
      offline_threading_id: token,
    },
    true,
  );
}

/**
 * Creates a group thread and returns its id. Instagram needs at least two other
 * participants for a group. With one, send to that user instead.
 */
export async function createGroupThread(
  client: PrivateClient,
  userIds: readonly string[],
  title = '',
): Promise<string> {
  checkedIds(userIds, 'User ids');
  if (userIds.length < 2) {
    throw new IgError('A group thread needs at least two other participants');
  }
  const json = await postAction(
    client,
    endpoints.directCreateGroupThread,
    endpoints.directCreateGroupThread.path,
    {
      _uuid: uuid(client),
      ...(client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {}),
      client_context: randomUUID(),
      is_partnership_folder: 'false',
      recipient_users: numericIdArray(userIds),
      thread_title: title,
    },
    false,
  );
  const nested = isRecord(json['thread']) ? json['thread']['thread_id'] : undefined;
  const threadId = json['thread_id'] ?? nested;
  if (typeof threadId !== 'string' && typeof threadId !== 'number') {
    throw new ClientSchemaError('create group response did not include a thread id', json);
  }
  return String(threadId);
}

/** The existing thread with exactly these participants, or undefined when there is none. */
export async function findThreadByParticipants(
  client: PrivateClient,
  userIds: readonly string[],
): Promise<Thread | undefined> {
  checkedIds(userIds, 'User ids');
  const json = await client.request({
    method: endpoints.directThreadByParticipants.method,
    endpoint: endpoints.directThreadByParticipants.path,
    query: { recipient_users: numericIdArray(userIds), seq_id: '2580572', limit: '20' },
  });
  const thread = json['thread'];
  if (!isRecord(thread)) {
    return undefined;
  }
  const parsed = threadSchema.safeParse(thread);
  if (!parsed.success) {
    throw new ClientSchemaError('direct thread did not match the thread schema', thread, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export type RecipientSearchMode = 'universal' | 'raven';

/** Searches the people the account can message, ranked, for a free-text query. */
export async function searchRecipients(
  client: PrivateClient,
  query: string,
  mode: RecipientSearchMode = 'universal',
): Promise<User[]> {
  const json = await client.request({
    method: endpoints.directRankedRecipients.method,
    endpoint: endpoints.directRankedRecipients.path,
    query: {
      max_ai_bot_results: '0',
      max_ig_bus_results: '10',
      mode,
      show_threads: 'true',
      query,
      max_ig_results: '10',
      max_ibc_results: '20',
      max_fb_results: '0',
    },
  });
  const ranked = json['ranked_recipients'];
  if (!Array.isArray(ranked)) {
    throw new ClientSchemaError('recipient search did not include ranked_recipients', json);
  }
  // Suggestions from Facebook come without a username. Only Instagram users are kept.
  const users = ranked
    .map((entry) => (isRecord(entry) ? entry['user'] : undefined))
    .filter(
      (user) => isRecord(user) && typeof user['username'] === 'string' && user['username'] !== '',
    );
  return parseSchemaList<User>(users, userSchema, 'user');
}
