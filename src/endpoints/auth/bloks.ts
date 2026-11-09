import type { PrivateClient } from '../../core/http/private-client';
import type { PrivateResponseJson } from '../../core/http/response';
import { buildBloksPayload } from '../../core/bloks/payload';
import { endpoints } from '../../generated/endpoints';

export interface BloksActionOptions {
  /** Bloks versioning id. Defaults to the session profile's value. */
  readonly bloksVersioningId?: string;
  /** API domain override. Defaults to the private-API domain. */
  readonly domain?: string;
  /** Per-request headers merged over the default friendly-name header. */
  readonly extraHeaders?: Record<string, string>;
}

/**
 * Performs a Bloks async action: posts the form-encoded Bloks payload to
 * `bloks/async_action/<action>/` and returns the parsed response. Bloks requests
 * are sent unsigned, so the body is plain form fields.
 */
export async function bloksAsyncAction(
  client: PrivateClient,
  action: string,
  params: Record<string, unknown>,
  options: BloksActionOptions = {},
): Promise<PrivateResponseJson> {
  const bloksVersioningId = options.bloksVersioningId ?? client.session.profile.bloksVersioningId;
  const payload = buildBloksPayload(params, {
    uuid: client.session.device.uuid,
    bloksVersioningId,
  });

  return client.request({
    method: endpoints.bloksAsyncAction.method,
    endpoint: `${endpoints.bloksAsyncAction.path}${action}/`,
    payload,
    encoding: 'form',
    withDefaultData: false,
    headers: {
      'X-FB-Friendly-Name': `IgApi: bloks/async_action/${action}/`,
      ...options.extraHeaders,
    },
    ...(options.domain !== undefined ? { domain: options.domain } : {}),
  });
}
