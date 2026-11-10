import { z } from 'zod';

/**
 * A user as the private API returns it. Only the fields the SDK exposes are
 * typed; everything else passes through untouched so an upstream addition does
 * not break callers. The API omits or nulls fields depending on privacy and
 * context, so the types say so rather than overpromising. `pk` arrives as a
 * number or a string and is normalized to a string id.
 */
export const userSchema = z
  .object({
    pk: z.coerce.string().optional(),
    username: z.string().optional(),
    full_name: z.string().optional(),
    is_private: z.boolean().optional(),
    is_verified: z.boolean().optional(),
    profile_pic_url: z.string().nullable().optional(),
    follower_count: z.number().nullable().optional(),
    following_count: z.number().nullable().optional(),
    media_count: z.number().nullable().optional(),
    biography: z.string().optional(),
  })
  .loose();

export type User = z.infer<typeof userSchema>;
