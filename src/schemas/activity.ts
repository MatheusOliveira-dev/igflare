import { z } from 'zod';

/**
 * One entry of the activity feed (a like, a comment, a new follower, a mention, ...).
 * `story_type` says which kind it is. The app has dozens and adds them often, so the
 * kind stays a number and everything else passes through untouched.
 */
export const activityItemSchema = z
  .object({
    pk: z.coerce.string().optional(),
    type: z.number().optional(),
    story_type: z.number().optional(),
    args: z
      .object({
        profile_id: z.coerce.string().optional(),
        profile_name: z.string().optional(),
        text: z.string().optional(),
        rich_text: z.string().optional(),
        timestamp: z.number().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

/** One entry of the activity feed. */
export type ActivityItem = z.infer<typeof activityItemSchema>;

/** The activity feed as the app shows it: what is new, what was already seen. */
export interface Activity {
  readonly newItems: ActivityItem[];
  readonly oldItems: ActivityItem[];
  /** Pending follow requests, when the account is private. */
  readonly friendRequestCount: number;
}
