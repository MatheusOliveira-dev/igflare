import type { PrivateClient } from './private-client';
import { API_DOMAIN } from './request-builder';

/** One persisted ("pando") GraphQL query, as the Android app sends it. */
export interface PandoQuery {
  /** The operation name, e.g. `TopSerpQuery`. */
  readonly friendlyName: string;
  /** The app build's persisted-query id for that operation. It changes between builds. */
  readonly docId: string;
  /** The single field the query selects at the root; the server uses it for routing. */
  readonly rootField: string;
  readonly variables: Record<string, unknown>;
  /** Defaults to the API host; the login flow uses its own host. */
  readonly domain?: string;
  /** Pre-login calls have no session to add default fields from. */
  readonly withDefaultData?: boolean;
}

/**
 * Sends a persisted GraphQL query to `graphql_www` and returns the parsed body, errors
 * included: whether a given `errors` entry is fatal depends on the query, so the caller
 * decides. This host is not an `/api/v1` path, which is why it is driven by `rawUrl`
 * and is absent from the endpoint manifest.
 */
export function pandoRequest(
  client: PrivateClient,
  query: PandoQuery,
): Promise<Record<string, unknown>> {
  const domain = query.domain ?? API_DOMAIN;
  return client.request({
    method: 'POST',
    endpoint: 'graphql_www',
    rawUrl: `https://${domain}/graphql_www`,
    encoding: 'form',
    ...(query.withDefaultData !== undefined ? { withDefaultData: query.withDefaultData } : {}),
    payload: {
      method: 'post',
      pretty: 'false',
      format: 'json',
      server_timestamps: 'true',
      locale: 'user',
      fb_api_req_friendly_name: query.friendlyName,
      enable_canonical_naming: 'true',
      enable_canonical_variable_overrides: 'true',
      enable_canonical_naming_ambiguous_type_prefixing: 'true',
      variables: JSON.stringify(query.variables),
      purpose: 'fetch',
      client_doc_id: query.docId,
    },
    headers: {
      'X-FB-Friendly-Name': query.friendlyName,
      'X-Client-Doc-Id': query.docId,
      'X-Root-Field-Name': query.rootField,
      'X-Graphql-Client-Library': 'pando',
    },
  });
}
