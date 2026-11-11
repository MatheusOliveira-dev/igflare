import type { PrivateClient } from './private-client';
import { API_DOMAIN } from './request-builder';
import { isRecord } from '../guards';
import { IgApiError } from '../../errors/api-errors';

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

/**
 * The value a persisted query answered at its root field. The response keys it as
 * `1$<rootField>(<arguments>)`, so the key is found by its prefix. When the query was
 * refused (`errors` and no `data`), this throws with the server's first message.
 */
export function pandoRoot(json: Record<string, unknown>, rootField: string, what: string): unknown {
  const data = json['data'];
  if (isRecord(data)) {
    const key = Object.keys(data).find((name) => name.startsWith(`1$${rootField}`));
    if (key !== undefined) {
      return data[key];
    }
  }
  const errors = json['errors'];
  const first = Array.isArray(errors) && isRecord(errors[0]) ? errors[0]['message'] : undefined;
  const reason = typeof first === 'string' ? ': ' + first : '';
  throw new IgApiError(`The ${what} was refused${reason}`, 200, { raw: json });
}

/** `1fvalue`, `1ltotal`: the server prefixes the key of a float or 64-bit field with its type. */
const TYPE_MARKER = /^1[fl](?=[a-z_])/;
/** `1$name(arguments)`: a nested field is keyed by its name and the variables it was given. */
const FIELD_KEY = /^1\$([A-Za-z_]\w*)\(/;

/**
 * Renames the keys of a persisted-query answer to the plain field names: drops the type
 * marker (`1fvalue` becomes `value`) and the argument list of a nested field
 * (`1$active_times(timezone:$timezone)` becomes `active_times`).
 */
export function stripPandoMarkers(value: unknown): unknown {
  if (Array.isArray(value)) {
    return (value as unknown[]).map(stripPandoMarkers);
  }
  if (!isRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const field = FIELD_KEY.exec(key);
    const name = field?.[1] ?? key.replace(TYPE_MARKER, '');
    out[name] = stripPandoMarkers(child);
  }
  return out;
}
