import { z } from 'zod';

/** A place/location as search and location feeds return it. Lean and lenient. */
export const locationSchema = z
  .object({
    pk: z.coerce.string().optional(),
    name: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    external_id: z.coerce.string().optional(),
    facebook_places_id: z.coerce.string().optional(),
  })
  .loose();

export type Location = z.infer<typeof locationSchema>;
