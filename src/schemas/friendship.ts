import { z } from 'zod';

/**
 * The relationship between the logged-in account and another user, as the private
 * API reports it on the friendships endpoints. Only the fields the SDK exposes are
 * typed. The rest pass through, and each is optional because the API includes a
 * different subset per endpoint and context.
 */
export const friendshipStatusSchema = z
  .object({
    following: z.boolean().optional(),
    followed_by: z.boolean().optional(),
    blocking: z.boolean().optional(),
    is_private: z.boolean().optional(),
    incoming_request: z.boolean().optional(),
    outgoing_request: z.boolean().optional(),
    is_bestie: z.boolean().optional(),
    is_restricted: z.boolean().optional(),
    muting: z.boolean().optional(),
    is_muting_reel: z.boolean().optional(),
  })
  .loose();

export type FriendshipStatus = z.infer<typeof friendshipStatusSchema>;
