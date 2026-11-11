import { z } from 'zod';

/**
 * One figure of an insights screen, with the text the app shows next to it. `value` is null
 * when the figure does not apply yet, and the text is then "--". The server sends the value
 * under `1fvalue`. The endpoints strip that marker before parsing.
 */
export const insightMetricSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    value: z.number().nullable().optional(),
    format: z.string().optional(),
    formatted_value: z.string().optional(),
  })
  .loose();

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

/** A bare figure, as the account screens nest them (`{ value: 15 }`). */
const figure = z.object({ value: count }).loose().nullable().optional();

/** A figure split between followers and people who do not follow the account. */
const followSplit = z
  .object({
    total: insightMetricSchema.nullable().optional(),
    follower: figure,
    non_follower: figure,
  })
  .loose()
  .nullable()
  .optional();

const contentTypeEntry = z
  .object({
    content_type: z.string(),
    total: count,
    follower_count: count,
    non_follower_count: count,
    facebook_count: count,
  })
  .loose();

/** The account's overview for a date range: views, interactions, reach and visits. */
export const accountInsightsSchema = z
  .object({
    account_views_count: z
      .object({
        total: insightMetricSchema.nullable().optional(),
        follow_type_breakdown: z
          .object({ follower: figure, non_follower: figure })
          .loose()
          .nullable()
          .optional(),
      })
      .loose()
      .nullable()
      .optional(),
    interactions_count: followSplit,
    viewers_or_reach: insightMetricSchema.nullable().optional(),
    profile_visits: figure,
    bio_link_taps: figure,
    link_page_views: figure,
    business_address_taps: figure,
    views_over_time: z.unknown().optional(),
    interactions_over_time: z.unknown().optional(),
    net_followers_over_time: z.unknown().optional(),
    account_views_by_content_type: z
      .object({ total: count, entries: z.array(contentTypeEntry).optional() })
      .loose()
      .nullable()
      .optional(),
    interactions_by_content_type: z
      .object({
        total_breakdown: z
          .object({ total: count, entries: z.array(contentTypeEntry).optional() })
          .loose()
          .nullable()
          .optional(),
        sub_breakdowns: z.array(z.unknown()).optional(),
      })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();

export type AccountInsights = z.infer<typeof accountInsightsSchema>;

const place = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    percentage: count,
    display_value: z.string().optional(),
  })
  .loose();

/** Who follows the account: how many, their ages, places and when they are online. */
export const audienceInsightsSchema = z
  .object({
    follower_count: insightMetricSchema.nullable().optional(),
    active_follower_count: insightMetricSchema.nullable().optional(),
    follower_growth_delta: z
      .object({ value: z.string().optional(), sentiment: z.string().optional() })
      .loose()
      .nullable()
      .optional(),
    net_followers_over_time: z.unknown().optional(),
    age_demographics: z
      .object({
        entries: z
          .array(
            z
              .object({
                age_range: z.string(),
                percentage: count,
                women_percentage: count,
                men_percentage: count,
                other_percentage: count,
              })
              .loose(),
          )
          .optional(),
      })
      .loose()
      .nullable()
      .optional(),
    gender_demographics: z.unknown().optional(),
    top_countries: z.array(place).optional(),
    top_cities: z.array(place).optional(),
    top_languages: z.array(place).optional(),
    active_times: z
      .object({
        slots: z
          .array(z.object({ day: z.number(), hour: z.number(), value: count }).loose())
          .optional(),
      })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();

export type AudienceInsights = z.infer<typeof audienceInsightsSchema>;

/** One post, reel or story in the content list, with the figures the list was sorted by. */
export const contentInsightSchema = z
  .object({
    thumbnail: z
      .object({
        media_id: z.coerce.string(),
        media_url: z.string().nullable().optional(),
        media_type: z.string().optional(),
        creation_time: z.number().optional(),
        caption_text: z.string().nullable().optional(),
      })
      .loose(),
    metrics: z.array(z.object({ metric: z.string(), value: count }).loose()).optional(),
  })
  .loose();

export type ContentInsight = z.infer<typeof contentInsightSchema>;

/** One page of the content list. */
export const contentPageSchema = z
  .object({
    items: z.array(contentInsightSchema),
    page_info: z
      .object({
        has_next_page: z.boolean().optional(),
        end_cursor: z.string().nullable().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
