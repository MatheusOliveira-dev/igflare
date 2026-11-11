import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { isRecord, readCursor } from '../../core/guards';
import { paginate } from '../../core/pagination';
import type { Page } from '../../core/pagination';
import { mediaSchema, type Media } from '../../schemas/media';
import { ClientSchemaError } from '../../errors/api-errors';

/** Paging for the Explore feed. */
export interface ExploreOptions {
  /** The cursor from a previous page's `nextCursor`. Omit for the first page. */
  readonly cursor?: string;
}

/** A section nests its posts a few levels down, differently for each layout. */
const MAX_DEPTH = 8;

/**
 * Collects the posts of the sections. The layouts differ (a full-width post, a grid, a
 * block of reels), but each post sits under a `media` key and has a `code`, so the sections
 * are searched for that instead of listing every layout.
 */
function collectMedias(value: unknown, found: unknown[], depth = 0): void {
  if (depth > MAX_DEPTH) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value as unknown[]) {
      collectMedias(entry, found, depth + 1);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const media = value['media'];
  if (isRecord(media) && typeof media['code'] === 'string') {
    found.push(media);
    return;
  }
  for (const child of Object.values(value)) {
    collectMedias(child, found, depth + 1);
  }
}

/** One page of the Explore feed. Pass `cursor` to continue. */
export async function getExploreFeed(
  client: PrivateClient,
  options: ExploreOptions = {},
): Promise<Page<Media>> {
  const json = await client.request({
    method: endpoints.discoverTopicalExplore.method,
    endpoint: endpoints.discoverTopicalExplore.path,
    ...(options.cursor !== undefined ? { query: { max_id: options.cursor } } : {}),
  });
  const sections = json['sectional_items'];
  if (!Array.isArray(sections)) {
    throw new ClientSchemaError('the explore answer did not include its sections', json);
  }
  const found: unknown[] = [];
  collectMedias(sections, found);
  const items = found.map((candidate) => {
    const parsed = mediaSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ClientSchemaError('an explore post did not match the schema', candidate, {
        cause: parsed.error,
      });
    }
    return parsed.data;
  });
  const next = readCursor(json, 'next_max_id') ?? readCursor(json, 'max_id');
  return next !== undefined && next !== '' && json['more_available'] !== false
    ? { items, nextCursor: next }
    : { items };
}

/** Walks the Explore feed, one post at a time across pages. */
export function paginateExploreFeed(client: PrivateClient): AsyncGenerator<Media> {
  return paginate((cursor) => getExploreFeed(client, cursor !== undefined ? { cursor } : {}));
}
