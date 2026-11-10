import type { PrivateClient } from '../../core/http/private-client';
import { endpoints } from '../../generated/endpoints';
import { mediaSchema, type Media } from '../../schemas/media';
import { ClientSchemaError } from '../../errors/api-errors';

/**
 * Fetches one media by its full id (the `pk_userid` composite the feed returns).
 * `media/{id}/info/` wraps the media in a one-element `items` array; the single
 * item is validated into the `Media` model. A missing item or a shape mismatch
 * surfaces as a typed error.
 */
export async function getMediaInfo(client: PrivateClient, mediaId: string): Promise<Media> {
  const json = await client.request({
    method: endpoints.mediaInfo.method,
    endpoint: endpoints.mediaInfo.path.replace('{id}', mediaId),
  });
  const items = json['items'];
  if (!Array.isArray(items) || items.length === 0) {
    throw new ClientSchemaError('media info response did not include a media item', json);
  }
  const parsed = mediaSchema.safeParse(items[0]);
  if (!parsed.success) {
    throw new ClientSchemaError('media info response did not match the media schema', items[0], {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
