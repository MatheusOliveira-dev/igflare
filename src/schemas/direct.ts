import { z } from 'zod';
import { userSchema } from './user';

/**
 * One item in a direct thread. Lean and lenient: `item_type` distinguishes the
 * payload (`text`, `media`, `like`, `link`, ...), so most fields are optional.
 * Timestamps arrive as microsecond strings and are kept as strings.
 */
export const directMessageSchema = z
  .object({
    item_id: z.string().optional(),
    item_type: z.string().optional(),
    user_id: z.coerce.string().optional(),
    timestamp: z.coerce.string().optional(),
    text: z.string().optional(),
  })
  .loose();

/** One message of a direct thread. */
export type DirectMessage = z.infer<typeof directMessageSchema>;

/**
 * A direct thread. The inbox returns threads with a `last_permanent_item`. The
 * thread endpoint fills `items`. The author list is the shared `User` model.
 */
export const threadSchema = z
  .object({
    thread_id: z.string().optional(),
    thread_title: z.string().optional(),
    is_group: z.boolean().optional(),
    last_activity_at: z.coerce.string().optional(),
    users: z.array(userSchema).optional(),
    items: z.array(directMessageSchema).optional(),
    last_permanent_item: directMessageSchema.optional(),
  })
  .loose();

/** A direct thread, as parsed by `threadSchema`. */
export type Thread = z.infer<typeof threadSchema>;

/** The result of sending a direct message. */
export const directSendResultSchema = z
  .object({
    item_id: z.string().optional(),
    thread_id: z.string().optional(),
    timestamp: z.coerce.string().optional(),
  })
  .loose();

/** Where a sent message landed: its thread, item id and time. */
export type DirectSendResult = z.infer<typeof directSendResultSchema>;
