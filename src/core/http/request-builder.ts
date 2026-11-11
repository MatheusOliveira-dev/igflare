import type { HttpMethod, HttpRequest } from '../transport/http-transport';
import { buildBaseHeaders } from '../transport/headers';
import { buildSignedBody, quotePlus } from '../signing/signer';
import { buildUsdidHeader } from '../crypto/usdid';
import type { SessionData } from '../session/session';

/** The host of the private API. */
export const API_DOMAIN = 'i.instagram.com';

/**
 * How the request body is encoded. `signed` is the default private-API body
 * (`signed_body=SIGNATURE.<json>`). `form` url-encodes the payload as plain
 * form fields, which the Bloks endpoints expect (they are sent unsigned).
 */
export type BodyEncoding = 'signed' | 'form';

/** Everything a private-API request is built from, the session included. */
export interface PrivateRequestInput {
  readonly method: HttpMethod;
  readonly endpoint: string;
  readonly session: SessionData;
  readonly payload?: Record<string, unknown>;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly withSignature?: boolean;
  readonly withDefaultData?: boolean;
  readonly encoding?: BodyEncoding;
  readonly domain?: string;
  /** A fully-formed URL, used as-is instead of building one under `/api/v1`. */
  readonly rawUrl?: string;
  /**
   * Raw bytes to send as the body verbatim (for binary uploads). When set it
   * bypasses signing/form encoding, and the caller supplies the `Content-Type`
   * via `headers`.
   */
  readonly rawBody?: Uint8Array;
  readonly now?: number;
}

function resolvePath(endpoint: string): string {
  return endpoint.startsWith('/') ? endpoint : `/v1/${endpoint}`;
}

/**
 * Builds the request path under the API host. A value already starting with
 * `/api/` (the full path a manifest endpoint carries) is used verbatim. Anything
 * else is treated as an under-`/api` endpoint and gets the `/api` prefix.
 */
function resolveUrl(endpoint: string, domain: string, query?: Record<string, string>): string {
  const path = endpoint.startsWith('/api/') ? endpoint : `/api${resolvePath(endpoint)}`;
  const url = `https://${domain}${path}`;
  if (query === undefined || Object.keys(query).length === 0) {
    return url;
  }
  return `${url}?${new URLSearchParams(query).toString()}`;
}

function formEncode(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([key, value]) => `${quotePlus(key)}=${quotePlus(String(value))}`)
    .join('&');
}

function buildBody(input: PrivateRequestInput): string | undefined {
  if (input.method === 'GET' || input.payload === undefined) {
    return undefined;
  }
  if (input.encoding === 'form') {
    return formEncode(input.payload);
  }
  const withDefaultData = input.withDefaultData ?? true;
  const data = withDefaultData
    ? {
        _uuid: input.session.device.uuid,
        device_id: input.session.device.androidDeviceId,
        ...input.payload,
      }
    : input.payload;
  const json = JSON.stringify(data);
  return (input.withSignature ?? true) ? buildSignedBody(json) : json;
}

/** Serializes the session cookies into a `Cookie` header value, or undefined when none. */
function serializeCookies(cookies: Record<string, string> | undefined): string | undefined {
  if (cookies === undefined) {
    return undefined;
  }
  const pairs = Object.entries(cookies);
  return pairs.length > 0 ? pairs.map(([name, value]) => `${name}=${value}`).join('; ') : undefined;
}

/** Builds a signed private-API request from the session. Pure: no network. */
export function buildPrivateRequest(input: PrivateRequestInput): HttpRequest {
  const { session } = input;
  const now = input.now ?? Date.now();
  const usdidHeader =
    session.usdid !== undefined
      ? buildUsdidHeader(session.usdid, { now: Math.floor(now / 1000) })
      : undefined;
  const cookie = serializeCookies(session.auth.cookies);

  const headers: Record<string, string> = {
    ...buildBaseHeaders({
      profile: session.profile,
      device: session.device,
      locale: session.location.locale,
      country: session.location.country,
      timezoneOffset: session.location.timezoneOffset,
      ...(session.auth.userId !== undefined ? { userId: session.auth.userId } : {}),
      ...(session.auth.mid !== undefined ? { mid: session.auth.mid } : {}),
      ...(session.auth.wwwClaim !== undefined ? { wwwClaim: session.auth.wwwClaim } : {}),
      ...(session.auth.authorization !== undefined
        ? { authorization: session.auth.authorization }
        : {}),
      ...(usdidHeader !== undefined ? { usdidHeader } : {}),
      ...(cookie !== undefined ? { cookie } : {}),
    }),
    'X-Pigeon-Rawclienttime': (now / 1000).toFixed(3),
    ...input.headers,
  };

  const body: string | Uint8Array | undefined = input.rawBody ?? buildBody(input);
  if (body !== undefined && input.rawBody === undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  }

  return {
    method: input.method,
    url: input.rawUrl ?? resolveUrl(input.endpoint, input.domain ?? API_DOMAIN, input.query),
    headers,
    ...(body !== undefined ? { body } : {}),
  };
}
