import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { mediaSchema, type Media } from '../../schemas/media';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { ClientSchemaError } from '../../errors/api-errors';

export interface FeedOptions {
  /** The cursor from a previous page's `nextMaxId`. Omit for the first page. */
  readonly maxId?: string;
}

/** Validates the `items` array of a feed response into typed Media models. */
function parseMediaList(json: Record<string, unknown>): Media[] {
  const items = json['items'];
  if (!Array.isArray(items)) {
    throw new ClientSchemaError('feed response did not include an items array', json);
  }
  return items.map((candidate) => {
    const parsed = mediaSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ClientSchemaError('a media item in the feed did not match the schema', candidate, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  });
}

/** Reads the next-page cursor from a feed response, or undefined on the last page. */
function readNextMaxId(json: Record<string, unknown>): string | undefined {
  const next = json['next_max_id'];
  return typeof next === 'string' || typeof next === 'number' ? String(next) : undefined;
}

/** One page of a user's own posts. Pass `maxId` from a previous page to continue. */
export async function getUserFeed(
  client: PrivateClient,
  pk: string,
  options: FeedOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.feedUser.method,
    endpoint: endpoints.feedUser.path.replace('{pk}', pk),
    ...(options.maxId !== undefined ? { query: { max_id: options.maxId } } : {}),
  });
  const items = parseMediaList(json);
  const nextMaxId = readNextMaxId(json);
  return nextMaxId !== undefined ? { items, nextMaxId } : { items };
}

/** Walks every post of a user, yielding one at a time across pages. */
export function paginateUserFeed(client: PrivateClient, pk: string): AsyncGenerator<Media> {
  return paginate((maxId) => getUserFeed(client, pk, maxId !== undefined ? { maxId } : {}));
}
