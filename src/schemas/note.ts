import { z } from 'zod';
import { userSchema } from './user';

/**
 * A note: the short text that sits over a profile picture in the inbox for a day. `audience`
 * is 0 for mutual followers and 1 for close friends. The times are Unix seconds.
 */
export const noteSchema = z
  .object({
    note_id: z.coerce.string(),
    text: z.string().optional(),
    audience: z.number().optional(),
    note_style: z.number().optional(),
    author_id: z.coerce.string().optional(),
    author: userSchema.optional(),
    created_at: z.number().optional(),
    expires_at: z.number().optional(),
    is_emoji_only: z.boolean().optional(),
  })
  .loose();

export type Note = z.infer<typeof noteSchema>;
