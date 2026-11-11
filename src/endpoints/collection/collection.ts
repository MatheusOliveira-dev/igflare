import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { checkedId } from '../../core/ids';
import { isRecord, readCursor } from '../../core/guards';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { collectionSchema, type Collection } from '../../schemas/collection';
import { mediaSchema, type Media } from '../../schemas/media';
import { parseSchemaList } from '../../schemas/parse-list';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { mediaAction, mediaActionPayload } from '../media/media';
import { assertIds } from '../direct/direct-wire';

/** The types the app asks for: the automatic ones and the ones a person makes. */
const COLLECTION_TYPES = '["ALL_MEDIA_AUTO_COLLECTION","PRODUCT_AUTO_COLLECTION","MEDIA"]';
/** A guard against a server that keeps saying there is more. */
const MAX_LIST_PAGES = 20;

export interface CollectionPageOptions {
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly cursor?: string;
}

/** Lists the account's collections, the automatic ones included. */
export async function listCollections(client: PrivateClient): Promise<Collection[]> {
  const collections: Collection[] = [];
  let cursor = '';
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const json = await client.request({
      method: endpoints.collectionsList.method,
      endpoint: endpoints.collectionsList.path,
      query: { collection_types: COLLECTION_TYPES, max_id: cursor },
    });
    collections.push(...parseSchemaList<Collection>(json['items'], collectionSchema, 'collection'));
    const next = readCursor(json, 'next_max_id') ?? readCursor(json, 'max_id');
    if (json['more_available'] !== true || next === undefined || next === '') {
      break;
    }
    cursor = next;
  }
  return collections;
}

/** The media an item of a saved or liked feed wraps (`{ media: {...} }`). */
function feedMedias(json: Record<string, unknown>, what: string): Media[] {
  const items = json['items'];
  if (!Array.isArray(items)) {
    throw new ClientSchemaError(`the ${what} feed did not include an items list`, json);
  }
  return (items as unknown[]).map((item) => {
    const candidate = isRecord(item) && isRecord(item['media']) ? item['media'] : item;
    const parsed = mediaSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ClientSchemaError(`a ${what} media did not match the schema`, candidate, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  });
}

function pageOf(items: Media[], json: Record<string, unknown>): Page<Media> {
  const next = readCursor(json, 'next_max_id');
  return next !== undefined && next !== '' && json['more_available'] !== false
    ? { items, nextCursor: next }
    : { items };
}

/** One page of the posts in a collection. Pass `cursor` to continue. */
export async function getCollectionMedias(
  client: PrivateClient,
  collectionId: string,
  options: CollectionPageOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.feedCollection.method,
    endpoint: endpoints.feedCollection.path.replace(
      '{id}',
      checkedId(collectionId, 'A collection id'),
    ),
    query: {
      include_igtv_preview: 'false',
      ...(options.cursor !== undefined ? { max_id: options.cursor } : {}),
    },
  });
  return pageOf(feedMedias(json, 'collection'), json);
}

/** One page of the posts the account has liked. Pass `cursor` to continue. */
export async function getLikedMedias(
  client: PrivateClient,
  options: CollectionPageOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.feedLiked.method,
    endpoint: endpoints.feedLiked.path,
    ...(options.cursor !== undefined ? { query: { max_id: options.cursor } } : {}),
  });
  return pageOf(feedMedias(json, 'liked'), json);
}

/** Creates a collection, optionally holding some posts from the start. */
export async function createCollection(
  client: PrivateClient,
  name: string,
  mediaIds: readonly string[] = [],
): Promise<Collection> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new IgError('A collection needs a name');
  }
  if (mediaIds.length > 0) {
    assertIds(mediaIds, 'Media ids');
  }
  const json = await client.request({
    method: endpoints.collectionsCreate.method,
    endpoint: endpoints.collectionsCreate.path,
    payload: {
      ...mediaActionPayload(client),
      module_name: 'collection_create',
      added_media_ids: `[${mediaIds.join(',')}]`,
      collection_visibility: '0',
      name: trimmed,
    },
  });
  const parsed = collectionSchema.safeParse(json);
  if (!parsed.success) {
    throw new ClientSchemaError('the new collection did not match the schema', json, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** Deletes a collection. The posts in it stay saved. */
export async function deleteCollection(client: PrivateClient, collectionId: string): Promise<void> {
  await mediaAction(
    client,
    endpoints.collectionsDelete,
    endpoints.collectionsDelete.path.replace('{id}', checkedId(collectionId, 'A collection id')),
    mediaActionPayload(client),
  );
}

/** Walks the posts of a collection, one at a time across pages. */
export function paginateCollectionMedias(
  client: PrivateClient,
  collectionId: string,
): AsyncGenerator<Media> {
  return paginate((cursor) =>
    getCollectionMedias(client, collectionId, cursor !== undefined ? { cursor } : {}),
  );
}

/** Walks the posts the account has liked, one at a time across pages. */
export function paginateLikedMedias(client: PrivateClient): AsyncGenerator<Media> {
  return paginate((cursor) => getLikedMedias(client, cursor !== undefined ? { cursor } : {}));
}
