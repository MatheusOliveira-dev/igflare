import { z } from 'zod';
import { userSchema } from './user';
import { mediaSchema } from './media';

/**
 * A story reel: a user's current story and its media items. Lean and lenient,
 * reusing the User and Media models. The reels tray returns one per user with an
 * active story; the user story endpoint returns a single reel.
 */
export const reelSchema = z
  .object({
    id: z.coerce.string().optional(),
    user: userSchema.optional(),
    items: z.array(mediaSchema).optional(),
    seen: z.number().nullable().optional(),
    expiring_at: z.number().nullable().optional(),
    latest_reel_media: z.number().nullable().optional(),
  })
  .loose();

export type Reel = z.infer<typeof reelSchema>;
