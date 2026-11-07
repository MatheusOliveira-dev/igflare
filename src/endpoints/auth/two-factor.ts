import type { PrivateClient } from '../../core/http/private-client';
import type { PrivateResponseJson } from '../../core/http/response';
import type { TwoFactorRequiredError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { generateUuid } from '../../core/transport/device';
import { finalizeLogin } from './login';

export interface TwoFactorOptions {
  readonly username: string;
  readonly code: string;
  /** 1 = SMS, 3 = authenticator app. Defaults to the method the error reports, else '1'. */
  readonly verificationMethod?: string;
}

function readTwoFactorIdentifier(error: TwoFactorRequiredError): string {
  const info = error.payload.raw?.['two_factor_info'];
  if (typeof info === 'object' && info !== null && 'two_factor_identifier' in info) {
    const id = info.two_factor_identifier;
    if (typeof id === 'string') {
      return id;
    }
  }
  throw new IgError('The two-factor response did not include a two_factor_identifier');
}

/**
 * Completes a login that returned TwoFactorRequired by submitting the code. On
 * success the session carries the user id and authorization, and is persisted.
 */
export async function twoFactorLogin(
  client: PrivateClient,
  error: TwoFactorRequiredError,
  options: TwoFactorOptions,
): Promise<PrivateResponseJson> {
  const { device } = client.session;
  const identifier = readTwoFactorIdentifier(error);
  const csrftoken = client.session.auth.cookies?.['csrftoken'];

  const payload = {
    verification_code: options.code,
    phone_id: device.phoneId,
    two_factor_identifier: identifier,
    username: options.username,
    trust_this_device: '0',
    guid: device.uuid,
    device_id: device.androidDeviceId,
    waterfall_id: generateUuid(),
    verification_method: options.verificationMethod ?? '1',
    ...(csrftoken !== undefined ? { _csrftoken: csrftoken } : {}),
  };

  const json = await client.request({
    method: 'POST',
    endpoint: 'accounts/two_factor_login/',
    payload,
    withDefaultData: false,
  });

  return finalizeLogin(client, json);
}
