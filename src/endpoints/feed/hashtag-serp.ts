import type { PrivateClient } from '../../core/http/private-client';
import { pandoRequest, pandoRoot } from '../../core/http/pando';
import type { Page } from '../../core/pagination';
import { isRecord } from '../../core/guards';
import { mediaSchema, type Media } from '../../schemas/media';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { randomUUID } from 'node:crypto';

/**
 * The hashtag page was replaced in app build 454 by the search results screen, which is
 * served by this persisted GraphQL query. The id belongs to that build (read from the
 * app's `client_persist_ids` asset); a new build can change it, and the symptom is a
 * `ClientSchemaError` or `IgApiError` from this call.
 */
const TOP_SERP_DOC_ID = '4185316819665014057952243780';
const ROOT_FIELD = 'xdt_fbsearch__top_serp_graphql';
const PAGE_SIZE = 12;

// The flags the app sends with every request. The query declares them as variables,
// so leaving them out is answered with `missing_required_variable_value`.
const FLAGS_ON = [
  'enable_clips_metadata_in_light_media',
  'enable_thumbnails_in_light_media',
  'exclude_main_user_field',
  'exclude_caption_user_field',
  'is_incremental_delivery_enabled',
  'enable_serp_clips_viewer_deduplication',
  'remove_paid_partnership_and_subtitles_from_lightweight',
  'remove_view_count_from_lightweight',
  'remove_unused_carousel_pending_post_count',
  'remove_unused_video_subtitles_confidence',
  'remove_unused_video_subtitles_status',
  'remove_unused_deprecated_owner_counts',
  'remove_unused_views_on_grid_status',
  'remove_duplicate_subtitle_delivery',
  'remove_duplicate_video_codec',
  'remove_duplicate_owner_legacy_fields',
  'remove_duplicate_carousel_rendition_metadata',
  'remove_duplicate_carousel_preview',
  'remove_duplicate_carousel_scrubber_layout_metadata',
  'fetch_serp_viewer_demotion_control',
  'enable_pando_connection',
  'is_discovery_grid_enabled',
  'exclude_pinned_posts',
  'include_journey_header',
  'enable_tentpole_story_previews',
  'include_profile_update_info',
  'include_search_social_context',
  'skip_over_fetched_user_fields',
  'is_synthetic_enabled',
  'include_serp_grid_ad_fields',
] as const;

const FLAGS_OFF = [
  'include_search_engine_attributes',
  'delay_clips_viewer_fragment',
  'should_include_media_overlay_info_in_lightweight',
  'include_clips_viewer_fragment',
  'is_page_info_fetched_in_separate_chunk',
  'should_fetch_timeline_in_skw',
] as const;

/** What a results page needs echoed back to return the page after it. */
interface SerpCursor {
  readonly after: string;
  readonly turn: number;
  readonly serpSessionId: string;
  readonly searchSessionId: string;
  readonly journeySessionId: string;
}

function encodeCursor(cursor: SerpCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): SerpCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      isRecord(parsed) &&
      typeof parsed['after'] === 'string' &&
      typeof parsed['turn'] === 'number' &&
      typeof parsed['serpSessionId'] === 'string' &&
      typeof parsed['searchSessionId'] === 'string' &&
      typeof parsed['journeySessionId'] === 'string'
    ) {
      return {
        after: parsed['after'],
        turn: parsed['turn'],
        serpSessionId: parsed['serpSessionId'],
        searchSessionId: parsed['searchSessionId'],
        journeySessionId: parsed['journeySessionId'],
      };
    }
  } catch {
    // fall through to the typed error below
  }
  throw new IgError('The cursor does not come from a hashtag feed page');
}

/** A hashtag as typed by a person: with or without the leading `#`, no spaces. */
function normalizeTag(tag: string): string {
  const name = tag.trim().replace(/^#/, '');
  if (name === '' || /[\s#]/.test(name)) {
    throw new IgError('A hashtag is one word, with or without the leading #');
  }
  return name;
}

function newSession(): SerpCursor {
  return {
    after: '',
    turn: 0,
    serpSessionId: randomUUID(),
    searchSessionId: randomUUID(),
    journeySessionId: randomUUID(),
  };
}

function serpVariables(
  tag: string,
  session: SerpCursor,
  isPagination: boolean,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(FLAGS_ON.map((name) => [name, true])),
    ...Object.fromEntries(FLAGS_OFF.map((name) => [name, false])),
    is_pagination_request: isPagination,
    query: `#${tag}`,
    search_type: 'SEARCH',
    search_surface: 'TOP_SERP',
    hcm_entrypoint: 'UNSPECIFIED',
    serp_session_id: session.serpSessionId,
    search_session_id: session.searchSessionId,
    journey_session_id: session.journeySessionId,
    turn_id: session.turn,
    in_serp_interacted_media_ids: [],
    requested_unit_types: ['MEDIA_GRID'],
    num_media_to_fetch: PAGE_SIZE,
    lightweight_carousel_count: 0,
    // `last_seen_media_ids` is left out on purpose: sending it, even empty, is refused.
    recently_clicked_units: [],
    after: isPagination ? session.after : null,
    xdt_fbsearch__top_serp_graphql_first: PAGE_SIZE,
    xdt_fbsearch__top_serp_graphql_stream_enabled: false,
    xdt_fbsearch__top_serp_graphql_stream_initial_count: 0,
  };
}

/**
 * The results carry the author with an id under `strong_id__` rather than `pk`; copy it
 * over so the shared `User` model has its usual id.
 */
function withAuthorPk(candidate: unknown): unknown {
  if (!isRecord(candidate) || !isRecord(candidate['user'])) {
    return candidate;
  }
  const user = candidate['user'];
  if (user['pk'] !== undefined || user['strong_id__'] === undefined) {
    return candidate;
  }
  return { ...candidate, user: { ...user, pk: user['strong_id__'] } };
}

function gridMedias(root: Record<string, unknown>): Media[] {
  const edges = root['edges'];
  if (!Array.isArray(edges)) {
    throw new ClientSchemaError('the search results did not include an edges list', root);
  }
  const medias: Media[] = [];
  for (const edge of edges) {
    const node = isRecord(edge) ? edge['node'] : undefined;
    if (!isRecord(node) || node['__typename'] !== 'XDTTopSerpMediaGridUnit') {
      continue;
    }
    const items = node['items'];
    for (const item of Array.isArray(items) ? items : []) {
      const parsed = mediaSchema.safeParse(withAuthorPk(item));
      if (!parsed.success) {
        throw new ClientSchemaError('a search result media did not match the schema', item, {
          cause: parsed.error,
        });
      }
      medias.push(parsed.data);
    }
  }
  return medias;
}

function nextCursor(root: Record<string, unknown>, previous: SerpCursor): string | undefined {
  const info = root['page_info'];
  if (!isRecord(info) || info['has_next_page'] !== true) {
    return undefined;
  }
  const after = info['end_cursor'];
  if (typeof after !== 'string' || after === '') {
    return undefined;
  }
  return encodeCursor({ ...previous, after, turn: previous.turn + 1 });
}

/**
 * One page of the posts the app lists for a hashtag. These come from the search
 * results ranked by relevance, not from a chronological feed, and each post is the
 * light form the grid uses: id, code, type, author and images, without caption, counts
 * or date. Use `media.info` for those.
 */
export async function getHashtagSerpPage(
  client: PrivateClient,
  tag: string,
  cursorValue?: string,
): Promise<Page<Media>> {
  const name = normalizeTag(tag);
  const session = cursorValue !== undefined ? decodeCursor(cursorValue) : newSession();
  const json = await pandoRequest(client, {
    friendlyName: 'TopSerpQuery',
    docId: TOP_SERP_DOC_ID,
    rootField: ROOT_FIELD,
    variables: serpVariables(name, session, cursorValue !== undefined),
  });

  const root = pandoRoot(json, ROOT_FIELD, 'hashtag search');
  if (!isRecord(root)) {
    throw new ClientSchemaError('the hashtag search answered with no results object', json);
  }

  const items = gridMedias(root);
  const next = nextCursor(root, session);
  return next !== undefined ? { items, nextCursor: next } : { items };
}
