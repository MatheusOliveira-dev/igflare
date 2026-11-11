import { z } from 'zod';
import { userSchema } from './user';

/**
 * A comment as the create endpoint returns it. Lean and lenient: only the exposed
 * fields are typed, the rest pass through, and each is optional because the API's
 * shape varies by context. The author is the shared `User` model.
 */
export const commentSchema = z
  .object({
    pk: z.coerce.string().optional(),
    text: z.string().optional(),
    created_at: z.number().optional(),
    content_type: z.string().optional(),
    status: z.string().optional(),
    user: userSchema.optional(),
  })
  .loose();

/** A comment, as parsed by `commentSchema`. */
export type Comment = z.infer<typeof commentSchema>;
