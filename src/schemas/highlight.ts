import { z } from 'zod';
import { mediaSchema } from './media';
import { userSchema } from './user';

/**
 * A story highlight. `id` is the app's form, `highlight:123`; the functions that take a
 * highlight accept that or the bare `123`. A highlight read on its own also carries its
 * stories under `items`; one listed on a profile does not.
 */
export const highlightSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    media_count: z.number().nullable().optional(),
    user: userSchema.optional(),
    items: z.array(mediaSchema).optional(),
  })
  .loose();

export type Highlight = z.infer<typeof highlightSchema>;
