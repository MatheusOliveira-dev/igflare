import { randomUUID } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import type { PrivateResponseJson } from '../../core/http/response';
import {
  generateUsdidIdentity,
  buildUsdidRegistrationToken,
  type UsdidIdentity,
} from '../../core/crypto/usdid';
import { buildAttestationParams } from '../../core/crypto/attestation';
import { extractAac } from '../../core/bloks/parser';
import { encryptPassword } from '../../core/crypto/password';
import { bloksAsyncAction } from './bloks';
import {
  CAA_API_DOMAIN,
  buildProcessClientDataParams,
  buildOauthTokenFetchParams,
  buildSendLoginParams,
  type SendLoginParams,
} from './caa-params';
import { applyCaaResult } from './caa-result';
import { resolveCaaTwoFactor, type TwoFactorSource } from './caa-two-factor';
import { fetchPasswordPublicKey } from './login';
import { endpoints } from '../../generated/endpoints';
import { IgError } from '../../errors/ig-error';
import { CaaTwoFactorRequiredError } from '../../errors/api-errors';
import { isRecord } from '../../core/guards';

export { CAA_API_DOMAIN };

const USDID_REGISTRATION_CLIENT_DOC_ID = '124930351917786857261002920888';

const PROCESS_CLIENT_DATA = 'com.bloks.www.bloks.caa.login.process_client_data_and_redirect';
const OAUTH_TOKEN_FETCH = 'com.bloks.www.caa.login.oauth.token.fetch.async';
const SEND_LOGIN_REQUEST = 'com.bloks.www.bloks.caa.login.async.send_login_request';

export interface CaaLoginCredentials {
  readonly username: string;
  readonly password: string;
}

export interface CaaLoginOptions {
  /** Where to get the two-factor code if the account asks for one. */
  readonly twoFactor?: TwoFactorSource;
}

/** Whether a string contains any non-ASCII code unit (mirrors Python str.isascii). */
function hasNonAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 127) {
      return true;
    }
  }
  return false;
}

/** Ensures the session has a USDID identity, creating and persisting one if absent. */
function ensureUsdid(client: PrivateClient): UsdidIdentity {
  const existing = client.session.usdid;
  if (existing !== undefined) {
    return existing;
  }
  const identity = generateUsdidIdentity();
  client.patchSession({ usdid: identity, usdidRegistered: false });
  return identity;
}

/** Registers the USDID public key with Instagram via the pando graphql mutation. */
async function registerUsdid(client: PrivateClient, identity: UsdidIdentity): Promise<boolean> {
  const variables = {
    input: {
      usdid_token: {
        sensitive_string_value: buildUsdidRegistrationToken(identity, {
          appId: client.session.profile.appId,
        }),
      },
      fdid: { sensitive_string_value: client.session.device.phoneId },
    },
  };
  const json = await client.request({
    method: 'POST',
    // graphql_www is a pando GraphQL host endpoint, not an /api/v1 REST path, so
    // it is driven by rawUrl and is intentionally absent from the manifest registry.
    endpoint: 'graphql_www',
    rawUrl: `https://${CAA_API_DOMAIN}/graphql_www`,
    encoding: 'form',
    withDefaultData: false,
    payload: {
      method: 'post',
      pretty: 'false',
      format: 'json',
      server_timestamps: 'true',
      locale: 'user',
      fb_api_req_friendly_name: 'IGUSDIDRegistrationMutation',
      enable_canonical_naming: 'true',
      enable_canonical_variable_overrides: 'true',
      enable_canonical_naming_ambiguous_type_prefixing: 'true',
      variables: JSON.stringify(variables),
      purpose: 'fetch',
      client_doc_id: USDID_REGISTRATION_CLIENT_DOC_ID,
    },
    headers: {
      'X-FB-Friendly-Name': 'IGUSDIDRegistrationMutation',
      'X-Client-Doc-Id': USDID_REGISTRATION_CLIENT_DOC_ID,
      'X-Root-Field-Name': 'usdid_registration',
      'X-Graphql-Client-Library': 'pando',
    },
  });
  const data = json['data'];
  if (!isRecord(data)) {
    return false;
  }
  return Object.entries(data).some(
    ([key, value]) =>
      key.includes('usdid_registration') && isRecord(value) && value['success'] === true,
  );
}

/** Opens the CAA login homepage and returns its server-issued account access context. */
async function processClientData(client: PrivateClient, waterfallId: string): Promise<string> {
  const { device } = client.session;
  const result = await bloksAsyncAction(
    client,
    PROCESS_CLIENT_DATA,
    buildProcessClientDataParams(device, waterfallId),
    { domain: CAA_API_DOMAIN },
  );
  return extractAac(result);
}

/** Requests the keystore attestation challenge nonce for the login request. */
async function createAndroidKeystore(client: PrivateClient): Promise<string> {
  const json = await client.request({
    method: endpoints.attestationCreateAndroidKeystore.method,
    endpoint: endpoints.attestationCreateAndroidKeystore.path,
    payload: { app_scoped_device_id: client.session.device.uuid, key_hash: '' },
    encoding: 'form',
    withDefaultData: false,
    domain: CAA_API_DOMAIN,
    headers: { 'X-FB-Friendly-Name': 'IgApi: attestation/create_android_keystore/' },
  });
  return typeof json['challenge_nonce'] === 'string' ? json['challenge_nonce'] : '';
}

/** The CAA OAuth token preflight, sent before the credentials. */
async function oauthTokenFetch(
  client: PrivateClient,
  username: string,
  aac: string,
  waterfallId: string,
  now: number,
): Promise<void> {
  const { device } = client.session;
  await bloksAsyncAction(
    client,
    OAUTH_TOKEN_FETCH,
    buildOauthTokenFetchParams(device, { username, aac, waterfallId, now }),
    { domain: CAA_API_DOMAIN },
  );
}

/** Sends the CAA/Bloks login request with the encrypted password and attestation. */
async function sendLoginRequest(
  client: PrivateClient,
  params: SendLoginParams,
): Promise<PrivateResponseJson> {
  const { device } = client.session;
  const textInputId = `${randomUUID().replace(/-/g, '').slice(0, 4)}ig`;
  const attestation = buildAttestationParams(params.challengeNonce);
  return bloksAsyncAction(
    client,
    SEND_LOGIN_REQUEST,
    buildSendLoginParams(device, params, textInputId),
    {
      domain: CAA_API_DOMAIN,
      ...(attestation ? { extraHeaders: { 'X-IG-Attest-Params': attestation } } : {}),
    },
  );
}

/**
 * Logs in through Instagram's current Android CAA/Bloks flow, which replaced the
 * retired `accounts/login/` endpoint. Registers the device's USDID key, runs the
 * CAA preflight (account access context + keystore attestation), then sends the
 * encrypted password. On success the session carries the user id and the
 * authorization token. When the account needs a two-factor code, the login
 * resolves it itself if `options.twoFactor` says where the code comes from;
 * otherwise a `CaaTwoFactorRequiredError` is thrown, to be resolved with
 * `resolveCaaTwoFactor`.
 */
export async function caaLogin(
  client: PrivateClient,
  credentials: CaaLoginCredentials,
  options: CaaLoginOptions = {},
): Promise<PrivateResponseJson> {
  const publicKey = await fetchPasswordPublicKey(client);

  const identity = ensureUsdid(client);
  if (client.session.usdidRegistered !== true) {
    const registered = await registerUsdid(client, identity);
    client.patchSession({ usdidRegistered: registered });
    await client.persist();
    if (!registered) {
      throw new IgError('USDID registration failed; cannot continue CAA login');
    }
  }

  const waterfallId = randomUUID();
  const aac = await processClientData(client, waterfallId);
  const challengeNonce = await createAndroidKeystore(client);
  if (!aac) {
    throw new IgError('CAA preflight did not return an account access context');
  }
  const now = Date.now();
  await oauthTokenFetch(client, credentials.username, aac, waterfallId, now);

  const result = await sendLoginRequest(client, {
    contactPoint: credentials.username,
    encryptedPassword: encryptPassword(credentials.password, publicKey),
    nonAscii: hasNonAscii(credentials.password),
    aac,
    waterfallId,
    challengeNonce,
    mid: client.session.auth.mid ?? '',
    now,
  });

  try {
    return await applyCaaResult(client, result, aac);
  } catch (error) {
    if (error instanceof CaaTwoFactorRequiredError && options.twoFactor !== undefined) {
      return resolveCaaTwoFactor(client, error, options.twoFactor);
    }
    throw error;
  }
}
