import { z } from 'zod';

/** A hashtag as search and tag feeds return it. Lean and lenient. */
export const hashtagSchema = z
  .object({
    id: z.coerce.string().optional(),
    name: z.string().optional(),
    media_count: z.number().nullable().optional(),
    search_result_subtitle: z.string().optional(),
  })
  .loose();

/** A hashtag, as parsed by `hashtagSchema`. */
export type Hashtag = z.infer<typeof hashtagSchema>;
