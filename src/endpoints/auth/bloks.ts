import type { PrivateClient } from '../../core/http/private-client';
import type { PrivateResponseJson } from '../../core/http/response';
import { buildBloksPayload } from '../../core/bloks/payload';
import { endpoints } from '../../generated/endpoints';
import type { EndpointDefinition } from '../../generated/endpoints';

export interface BloksActionOptions {
  /** Bloks versioning id. Defaults to the session profile's value. */
  readonly bloksVersioningId?: string;
  /** API domain override. Defaults to the private-API domain. */
  readonly domain?: string;
  /** Per-request headers merged over the default friendly-name header. */
  readonly extraHeaders?: Record<string, string>;
}

/**
 * Posts a form-encoded, unsigned Bloks payload to `<definition.path><name>/`.
 * `friendlyName` adds the `X-FB-Friendly-Name` header the async actions carry.
 */
function postBloks(
  client: PrivateClient,
  definition: EndpointDefinition,
  name: string,
  params: Record<string, unknown>,
  options: BloksActionOptions,
  friendlyName: string | undefined,
): Promise<PrivateResponseJson> {
  const bloksVersioningId = options.bloksVersioningId ?? client.session.profile.bloksVersioningId;
  const payload = buildBloksPayload(params, {
    uuid: client.session.device.uuid,
    bloksVersioningId,
  });
  const headers = {
    ...(friendlyName !== undefined ? { 'X-FB-Friendly-Name': friendlyName } : {}),
    ...options.extraHeaders,
  };

  return client.request({
    method: definition.method,
    endpoint: `${definition.path}${name}/`,
    payload,
    encoding: 'form',
    withDefaultData: false,
    headers,
    ...(options.domain !== undefined ? { domain: options.domain } : {}),
  });
}

/**
 * Performs a Bloks async action: posts the form-encoded Bloks payload to
 * `bloks/async_action/<action>/` and returns the parsed response. Bloks requests
 * are sent unsigned, so the body is plain form fields.
 */
export function bloksAsyncAction(
  client: PrivateClient,
  action: string,
  params: Record<string, unknown>,
  options: BloksActionOptions = {},
): Promise<PrivateResponseJson> {
  return postBloks(
    client,
    endpoints.bloksAsyncAction,
    action,
    params,
    options,
    `IgApi: bloks/async_action/${action}/`,
  );
}

/**
 * Opens a Bloks app screen: the same payload as an async action, posted to
 * `bloks/apps/<app>/`. The app request carries no friendly-name header.
 */
export function bloksApp(
  client: PrivateClient,
  app: string,
  params: Record<string, unknown>,
  options: BloksActionOptions = {},
): Promise<PrivateResponseJson> {
  return postBloks(client, endpoints.bloksApps, app, params, options, undefined);
}
