import type { HttpMethod, HttpRequest } from '../transport/http-transport';
import { buildBaseHeaders } from '../transport/headers';
import { buildSignedBody } from '../signing/signer';
import type { SessionData } from '../session/session';

export const API_DOMAIN = 'i.instagram.com';

export interface PrivateRequestInput {
  readonly method: HttpMethod;
  readonly endpoint: string;
  readonly session: SessionData;
  readonly payload?: Record<string, unknown>;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly withSignature?: boolean;
  readonly withDefaultData?: boolean;
  readonly domain?: string;
  readonly now?: number;
}

function resolvePath(endpoint: string): string {
  return endpoint.startsWith('/') ? endpoint : `/v1/${endpoint}`;
}

function resolveUrl(endpoint: string, domain: string, query?: Record<string, string>): string {
  const url = `https://${domain}/api${resolvePath(endpoint)}`;
  if (query === undefined || Object.keys(query).length === 0) {
    return url;
  }
  return `${url}?${new URLSearchParams(query).toString()}`;
}

function buildBody(input: PrivateRequestInput): string | undefined {
  if (input.method === 'GET' || input.payload === undefined) {
    return undefined;
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

/** Builds a signed private-API request from the session. Pure: no network. */
export function buildPrivateRequest(input: PrivateRequestInput): HttpRequest {
  const { session } = input;
  const now = input.now ?? Date.now();

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
    }),
    'X-Pigeon-Rawclienttime': (now / 1000).toFixed(3),
    ...input.headers,
  };

  const body = buildBody(input);
  if (body !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
  }

  return {
    method: input.method,
    url: resolveUrl(input.endpoint, input.domain ?? API_DOMAIN, input.query),
    headers,
    ...(body !== undefined ? { body } : {}),
  };
}
