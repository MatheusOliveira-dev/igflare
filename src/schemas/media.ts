import { z } from 'zod';
import { userSchema } from './user';

/** One image/video rendition the API lists under `image_versions2` / `video_versions`. */
const mediaVersionSchema = z
  .object({
    url: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .loose();

/**
 * A media post as the feed endpoints return it. A lean first cut: only the fields
 * the SDK exposes are typed, the rest pass through, and each is optional/nullable
 * because the API's shape varies by media type (photo/video/carousel) and context.
 * `media_type` is 1 = photo, 2 = video, 8 = carousel. The author is the shared
 * `User` model.
 */
export const mediaSchema = z
  .object({
    pk: z.coerce.string().optional(),
    id: z.string().optional(),
    code: z.string().optional(),
    media_type: z.number().optional(),
    taken_at: z.number().optional(),
    like_count: z.number().nullable().optional(),
    comment_count: z.number().nullable().optional(),
    caption: z.object({ text: z.string().optional() }).loose().nullable().optional(),
    user: userSchema.optional(),
    image_versions2: z
      .object({ candidates: z.array(mediaVersionSchema).optional() })
      .loose()
      .optional(),
    video_versions: z.array(mediaVersionSchema).nullable().optional(),
    /**
     * The people tagged in the post. `null` or empty when nobody is. (`fb_user_tags` is
     * a different field and stays empty even for a tagged post.)
     */
    usertags: z
      .object({
        in: z
          .array(
            z
              .object({ position: z.array(z.number()).optional(), user: userSchema.optional() })
              .loose(),
          )
          .optional(),
      })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();

export type Media = z.infer<typeof mediaSchema>;
