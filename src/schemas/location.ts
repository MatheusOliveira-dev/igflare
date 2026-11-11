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

/** What a single location's own page knows: contact details, category and post count. */
export const locationInfoSchema = z
  .object({
    location_id: z.coerce.string(),
    facebook_places_id: z.coerce.string().optional(),
    name: z.string().optional(),
    slug: z.string().optional(),
    phone: z.string().optional(),
    website: z.string().optional(),
    category: z.string().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    location_address: z.string().optional(),
    location_city: z.string().optional(),
    location_zip: z.string().optional(),
    media_count: z.number().nullable().optional(),
  })
  .loose();

export type LocationInfo = z.infer<typeof locationInfoSchema>;
