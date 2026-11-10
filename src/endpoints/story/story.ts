import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { reelSchema, type Reel } from '../../schemas/reel';
import { mediaSchema, type Media } from '../../schemas/media';
import { parseSchemaList } from '../../schemas/parse-list';
import { IgError } from '../../errors/ig-error';

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

/**
 * Marks stories as seen, so the account appears among the owner's viewers. Takes the full
 * story ids (`pk_userid`), the `id` of each story media.
 */
export async function markStoriesSeen(
  client: PrivateClient,
  storyIds: readonly string[],
): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const reels: Record<string, string[]> = {};
  for (const id of storyIds) {
    const match = /^(\d+)_(\d+)$/.exec(id);
    if (match === null) {
      throw new IgError('A story id looks like 123456_789');
    }
    const [, pk, owner] = match;
    // The app reports the viewing window of each story as "begin_end" in seconds.
    reels[`${String(pk)}_${String(owner)}_${String(owner)}`] = [
      `${String(nowSeconds - 2)}_${String(nowSeconds)}`,
    ];
  }
  if (storyIds.length === 0) {
    throw new IgError('Pass at least one story id');
  }
  await client.request({
    method: endpoints.mediaSeenV2.method,
    endpoint: endpoints.mediaSeenV2.path,
    query: { reel: '1', live_vod: '0' },
    payload: {
      container_module: 'feed_timeline',
      live_vods_skipped: {},
      nuxes_skipped: {},
      nuxes: {},
      reels,
      live_vods: {},
      reel_media_skipped: {},
    },
  });
}
