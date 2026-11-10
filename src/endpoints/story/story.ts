import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { reelSchema, type Reel } from '../../schemas/reel';
import { mediaSchema, type Media } from '../../schemas/media';
import { parseSchemaList } from '../../schemas/parse-list';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The story tray: one reel per account the session follows that has an active story. */
export async function getReelsTray(client: PrivateClient): Promise<Reel[]> {
  const json = await client.request({
    method: endpoints.feedReelsTray.method,
    endpoint: endpoints.feedReelsTray.path,
    payload: { reason: 'cold_start', timezone_offset: '0' },
  });
  return parseSchemaList<Reel>(json['tray'], reelSchema, 'reel');
}

/**
 * A user's current story media, newest last. Returns an empty array when the user
 * has no active story (the `reel` is null).
 */
export async function getUserStories(client: PrivateClient, pk: string): Promise<Media[]> {
  const json = await client.request({
    method: endpoints.feedUserStory.method,
    endpoint: endpoints.feedUserStory.path.replace('{pk}', pk),
  });
  const reel = json['reel'];
  if (!isRecord(reel)) {
    return [];
  }
  return parseSchemaList<Media>(reel['items'] ?? [], mediaSchema, 'story media');
}
