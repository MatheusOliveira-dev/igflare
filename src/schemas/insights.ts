import { z } from 'zod';

/**
 * One figure of an insights screen. The server keeps the number under `1fvalue` (its marker
 * for a float field) and a text ready to show next to it; `value` is null when the figure
 * does not apply yet, and the text is then "--".
 */
export const insightMetricSchema = z.preprocess(
  (raw) =>
    typeof raw === 'object' && raw !== null && '1fvalue' in raw
      ? { ...raw, value: (raw as Record<string, unknown>)['1fvalue'] }
      : raw,
  z
    .object({
      id: z.string(),
      label: z.string(),
      value: z.number().nullable().optional(),
      format: z.string().optional(),
      formatted_value: z.string().optional(),
    })
    .loose(),
);

export type InsightMetric = z.infer<typeof insightMetricSchema>;

const count = z.number().nullable().optional();

/**
 * What the account's own insights say about one post or reel. The counts are for the whole
 * life of the media. Reels add the watch figures (`avg_watch_time`, `performance_factors`).
 * Only professional accounts have these, and only for their own media.
 */
export const mediaInsightsSchema = z
  .object({
    media_id: z.coerce.string(),
    thumbnail_url: z.string().nullable().optional(),
    likes: count,
    comments: count,
    saves: count,
    shares: count,
    reposts: count,
    total_views: count,
    follows: count,
    profile_visits: count,
    followers_views: count,
    non_followers_views: count,
    viewers_or_reach: insightMetricSchema.nullable().optional(),
    avg_watch_time: insightMetricSchema.nullable().optional(),
    views_sources: z.array(insightMetricSchema).optional(),
    performance_factors: z.array(insightMetricSchema).optional(),
    demographics: z
      .object({
        status: z.string().optional(),
        age_breakdown: z.array(z.unknown()).optional(),
        gender_breakdown: z.array(z.unknown()).optional(),
        country_breakdown: z.array(z.unknown()).optional(),
      })
      .loose()
      .nullable()
      .optional(),
    views_over_time: z.unknown().optional(),
  })
  .loose();

export type MediaInsights = z.infer<typeof mediaInsightsSchema>;
