import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { checkedId } from '../../core/ids';
import { isRecord } from '../../core/guards';
import { highlightSchema, type Highlight } from '../../schemas/highlight';
import { parseSchemaList } from '../../schemas/parse-list';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { mediaAction } from '../media/media';
import { uploadHighlightCover } from '../upload/upload';

/** What the app says it can render; the server shapes the reels it returns by it. */
const SUPPORTED_CAPABILITIES = JSON.stringify([
  {
    value:
      '119.0,120.0,121.0,122.0,123.0,124.0,125.0,126.0,127.0,128.0,129.0,130.0,131.0,132.0,' +
      '133.0,134.0,135.0,136.0,137.0,138.0,139.0,140.0,141.0,142.0',
    name: 'SUPPORTED_SDK_VERSIONS',
  },
  { value: '14', name: 'FACE_TRACKER_VERSION' },
  { value: 'ETC2_COMPRESSION', name: 'COMPRESSION' },
  { value: 'gyroscope_enabled', name: 'gyroscope' },
]);

/** The part of a story the cover shows, as fractions of its width and height. */
const DEFAULT_CROP = '[0.0,0.21830457,1.0,0.78094524]';
const FULL_CROP = '[0.0,0.0,1.0,1.0]';

/** The number in `highlight:123` (or the bare `123`), checked as a numeric id. */
function highlightPk(id: string): string {
  return checkedId(
    id.startsWith('highlight:') ? id.slice('highlight:'.length) : id,
    'A highlight id',
  );
}

/**
 * A story id the way the highlight calls want it: `pk_ownerPk`. A bare pk is taken to be
 * one of the logged-in account's own stories, which is the only kind a highlight holds.
 */
function storyId(client: PrivateClient, id: string): string {
  if (/^\d+_\d+$/.test(id)) {
    return id;
  }
  const owner = client.session.auth.userId;
  if (/^\d+$/.test(id) && owner !== undefined) {
    return `${id}_${owner}`;
  }
  throw new IgError('A story id looks like 123456_789');
}

function storyIds(client: PrivateClient, ids: readonly string[]): string[] {
  if (ids.length === 0) {
    throw new IgError('Give at least one story');
  }
  return ids.map((id) => storyId(client, id));
}

function parseHighlight(value: unknown, what: string): Highlight {
  const parsed = highlightSchema.safeParse(value);
  if (!parsed.success) {
    throw new ClientSchemaError(`the ${what} did not match the highlight schema`, value, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function ownerFields(client: PrivateClient): Record<string, string> {
  return client.session.auth.userId !== undefined ? { _uid: client.session.auth.userId } : {};
}

/** The highlights on a profile (without their stories; read one for those). */
export async function listHighlights(client: PrivateClient, userId: string): Promise<Highlight[]> {
  const json = await client.request({
    method: endpoints.highlightsTray.method,
    endpoint: endpoints.highlightsTray.path.replace('{id}', checkedId(userId, 'A user id')),
    query: {
      supported_capabilities_new: SUPPORTED_CAPABILITIES,
      phone_id: client.session.device.phoneId,
      panavision_mode: '',
    },
  });
  const tray = json['tray'];
  return parseSchemaList<Highlight>(tray ?? [], highlightSchema, 'highlight');
}

/** One highlight with its stories. */
export async function getHighlight(client: PrivateClient, id: string): Promise<Highlight> {
  const key = `highlight:${highlightPk(id)}`;
  const json = await client.request({
    method: endpoints.feedReelsMedia.method,
    endpoint: endpoints.feedReelsMedia.path,
    payload: {
      exclude_media_ids: '[]',
      supported_capabilities_new: SUPPORTED_CAPABILITIES,
      source: 'profile',
      user_ids: [key],
      ...ownerFields(client),
    },
  });
  const reels = json['reels'];
  const reel = isRecord(reels) ? reels[key] : undefined;
  return parseHighlight(reel, 'highlight');
}

export interface CreateHighlightOptions {
  /** The story whose picture is the cover. Defaults to the first of the stories. */
  readonly coverStoryId?: string;
}

/** Creates a highlight from some of the account's own stories (still on, or archived). */
export async function createHighlight(
  client: PrivateClient,
  title: string,
  stories: readonly string[],
  options: CreateHighlightOptions = {},
): Promise<Highlight> {
  const name = title.trim();
  if (name === '') {
    throw new IgError('A highlight needs a title');
  }
  const ids = storyIds(client, stories);
  const cover = options.coverStoryId !== undefined ? storyId(client, options.coverStoryId) : ids[0];
  const json = await client.request({
    method: endpoints.highlightsCreateReel.method,
    endpoint: endpoints.highlightsCreateReel.path,
    payload: {
      supported_capabilities_new: SUPPORTED_CAPABILITIES,
      source: 'self_profile',
      creation_id: String(Math.floor(Date.now() / 1000)),
      cover: JSON.stringify({ media_id: cover, crop_rect: DEFAULT_CROP }),
      title: name,
      media_ids: JSON.stringify(ids),
      ...ownerFields(client),
    },
  });
  return parseHighlight(json['reel'], 'new highlight');
}

export interface EditHighlightOptions {
  readonly title?: string;
  /** Stories to put in. */
  readonly addStoryIds?: readonly string[];
  /** Stories to take out. */
  readonly removeStoryIds?: readonly string[];
  /** Use one of its stories as the cover. */
  readonly coverStoryId?: string;
  /** Use this picture as the cover instead (a JPEG). */
  readonly coverJpeg?: Uint8Array;
}

/** Changes a highlight: its title, its stories or its cover. */
export async function editHighlight(
  client: PrivateClient,
  id: string,
  options: EditHighlightOptions,
): Promise<Highlight> {
  const pk = highlightPk(id);
  const added = options.addStoryIds !== undefined ? storyIds(client, options.addStoryIds) : [];
  const removed =
    options.removeStoryIds !== undefined ? storyIds(client, options.removeStoryIds) : [];
  if (options.title?.trim() === '') {
    throw new IgError('A highlight needs a title');
  }
  if (options.coverStoryId !== undefined && options.coverJpeg !== undefined) {
    throw new IgError('Give the cover as a story or as a picture, not both');
  }

  let cover: Record<string, string> | undefined;
  if (options.coverStoryId !== undefined) {
    cover = { media_id: storyId(client, options.coverStoryId), crop_rect: DEFAULT_CROP };
  } else if (options.coverJpeg !== undefined) {
    cover = {
      upload_id: await uploadHighlightCover(client, options.coverJpeg),
      crop_rect: FULL_CROP,
    };
  }

  const json = await client.request({
    method: endpoints.highlightsEditReel.method,
    endpoint: endpoints.highlightsEditReel.path.replace('{id}', pk),
    payload: {
      supported_capabilities_new: SUPPORTED_CAPABILITIES,
      source: 'self_profile',
      added_media_ids: JSON.stringify(added),
      removed_media_ids: JSON.stringify(removed),
      ...(options.title !== undefined ? { title: options.title.trim() } : {}),
      ...(cover !== undefined ? { cover: JSON.stringify(cover) } : {}),
      ...ownerFields(client),
    },
  });
  return parseHighlight(json['reel'], 'edited highlight');
}

/** Deletes a highlight. The stories in it are not deleted. */
export async function deleteHighlight(client: PrivateClient, id: string): Promise<void> {
  await mediaAction(
    client,
    endpoints.highlightsDeleteReel,
    endpoints.highlightsDeleteReel.path.replace('{id}', highlightPk(id)),
    ownerFields(client),
  );
}
