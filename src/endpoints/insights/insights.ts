import type { PrivateClient } from '../../core/http/private-client';
import { pandoRequest, pandoRoot } from '../../core/http/pando';
import { checkedMediaId } from '../../core/ids';
import { isRecord } from '../../core/guards';
import { mediaInsightsSchema, type MediaInsights } from '../../schemas/insights';
import { ClientSchemaError, IgApiError } from '../../errors/api-errors';

// Persisted-query ids of the app build this client reports (454); a new build can change
// them, and the symptom is a typed error from these calls.
const POST_INSIGHTS_DOC_ID = '187673829817521675190278983686';
const REEL_INSIGHTS_DOC_ID = '34117726174753558798011202277';

interface MediaQuery {
  readonly friendlyName: string;
  readonly docId: string;
  readonly rootField: string;
}

const POST: MediaQuery = {
  friendlyName: 'PostInsightsQuery',
  docId: POST_INSIGHTS_DOC_ID,
  rootField: 'ig_post_insights',
};
const REEL: MediaQuery = {
  friendlyName: 'ReelInsightsQuery',
  docId: REEL_INSIGHTS_DOC_ID,
  rootField: 'ig_reel_insights',
};

async function getMediaInsights(
  client: PrivateClient,
  mediaId: string,
  query: MediaQuery,
): Promise<MediaInsights> {
  const pk = checkedMediaId(mediaId).split('_')[0] ?? mediaId;
  const json = await pandoRequest(client, {
    ...query,
    variables: {
      mediaIgid: pk,
      bloksVersioningId: client.session.profile.bloksVersioningId,
      translationsOverviewEnabled: false,
    },
  });
  const root = pandoRoot(json, query.rootField, 'insights');
  if (!isRecord(root)) {
    // The query is accepted for any media, and answers an empty root for one the account
    // cannot read insights of (somebody else's, or an account that is not professional).
    const errors = json['errors'];
    const first = Array.isArray(errors) && isRecord(errors[0]) ? errors[0]['message'] : undefined;
    throw new IgApiError(
      `No insights for this media${typeof first === 'string' ? ': ' + first : ''}`,
      200,
      { raw: json },
    );
  }
  const parsed = mediaInsightsSchema.safeParse(root);
  if (!parsed.success) {
    throw new ClientSchemaError('the insights did not match the schema', root, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** Insights of one of the account's own posts: views, reach, interactions, where views came from. */
export function getPostInsights(client: PrivateClient, mediaId: string): Promise<MediaInsights> {
  return getMediaInsights(client, mediaId, POST);
}

/** Insights of one of the account's own reels: the post figures plus watch time and rates. */
export function getReelInsights(client: PrivateClient, mediaId: string): Promise<MediaInsights> {
  return getMediaInsights(client, mediaId, REEL);
}
