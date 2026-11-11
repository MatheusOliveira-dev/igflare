import { z } from 'zod';

/**
 * A saved-posts collection. Besides the ones a person makes, the app lists automatic
 * ones (all saved posts, products). `collection_type` tells them apart.
 */
export const collectionSchema = z
  .object({
    collection_id: z.coerce.string(),
    collection_name: z.string().optional(),
    collection_type: z.string().optional(),
    collection_media_count: z.number().nullable().optional(),
  })
  .loose();

export type Collection = z.infer<typeof collectionSchema>;
