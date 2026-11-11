import { z } from 'zod';

/** One link in a profile's link list. `link_id` is normalized to a string id. */
export const bioLinkSchema = z
  .object({
    link_id: z.coerce.string().optional(),
    url: z.string(),
    title: z.string().nullable().optional(),
    link_type: z.string().nullable().optional(),
  })
  .loose();

export type BioLink = z.infer<typeof bioLinkSchema>;
