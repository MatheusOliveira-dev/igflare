import { randomUUID } from 'node:crypto';
import type { PrivateClient } from '../../core/http/private-client';
import type { PrivateResponseJson } from '../../core/http/response';
import {
  generateUsdidIdentity,
  buildUsdidRegistrationToken,
  type UsdidIdentity,
} from '../../core/crypto/usdid';
import { buildAttestationParams } from '../../core/crypto/attestation';
import { caaDeviceNetworkInfo } from '../../core/bloks/payload';
import { extractAac, extractLoginResponse, allText } from '../../core/bloks/parser';
import { encryptPassword } from '../../core/crypto/password';
import { bloksAsyncAction } from './bloks';
import { fetchPasswordPublicKey } from './login';
import { endpoints } from '../../generated/endpoints';
import { IgError } from '../../errors/ig-error';
import { TwoFactorRequiredError } from '../../errors/api-errors';

/** The domain the CAA/Bloks login flow talks to. */
export const CAA_API_DOMAIN = 'b.i.instagram.com';

const USDID_REGISTRATION_CLIENT_DOC_ID = '124930351917786857261002920888';
const OFFLINE_EXPERIMENT_GROUP = 'caa_iteration_v3_perf_ig_4';
const AP_2SV_ENTRYPOINT = 'com.bloks.www.ap.two_step_verification.entrypoint_async';
const LATENCY_QPL_MARKER_ID = 36707139;

const PROCESS_CLIENT_DATA = 'com.bloks.www.bloks.caa.login.process_client_data_and_redirect';
const OAUTH_TOKEN_FETCH = 'com.bloks.www.caa.login.oauth.token.fetch.async';
const SEND_LOGIN_REQUEST = 'com.bloks.www.bloks.caa.login.async.send_login_request';

export interface CaaLoginCredentials {
  readonly username: string;
  readonly password: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function extractUserId(loginResponse: Record<string, unknown>): string | undefined {
  const user = loginResponse['logged_in_user'];
  if (isRecord(user) && (typeof user['pk'] === 'number' || typeof user['pk'] === 'string')) {
    return String(user['pk']);
  }
  return undefined;
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
    {
      is_from_logged_out: false,
      logged_out_user: '',
      qpl_join_id: null,
      family_device_id: device.phoneId,
      device_id: device.androidDeviceId,
      offline_experiment_group: OFFLINE_EXPERIMENT_GROUP,
      waterfall_id: waterfallId,
      logout_source: '',
      show_internal_settings: false,
      last_auto_login_time: 0,
      disable_auto_login: false,
      qe_device_id: device.uuid,
      use_auto_login_interstitial: true,
      disable_recursive_auto_login_interstitial: true,
      auto_login_interstitial_experiment_group_name: '',
      is_from_logged_in_switcher: false,
      switcher_logged_in_uid: '',
      account_list: [],
      blocked_uid: [],
      INTERNAL_INFRA_THEME: 'THREE_NEUTRAL_GRAY',
      layered_homepage_experiment_group: 'Deploy: Not in Experiment',
      launched_url: '',
      sim_phone_numbers: [],
      is_from_registration_reminder: false,
    },
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
    {
      client_input_params: {
        username_input: username,
        si_device_param_network_info: caaDeviceNetworkInfo(),
        aac,
        lois_settings: { lois_token: '' },
        cloud_trust_token: null,
        zero_balance_state: '',
        network_bssid: null,
      },
      server_params: {
        is_from_logged_out: 0,
        layered_homepage_experiment_group: 'Deploy: Not in Experiment',
        device_id: device.androidDeviceId,
        login_surface: 'login_home',
        waterfall_id: waterfallId,
        INTERNAL__latency_qpl_instance_id: now,
        is_platform_login: 0,
        login_entry_point: 'logged_out',
        INTERNAL__latency_qpl_marker_id: LATENCY_QPL_MARKER_ID,
        family_device_id: device.phoneId,
        offline_experiment_group: OFFLINE_EXPERIMENT_GROUP,
        access_flow_version: 'pre_mt_behavior',
        is_from_logged_in_switcher: 0,
        qe_device_id: device.uuid,
      },
    },
    { domain: CAA_API_DOMAIN },
  );
}

interface SendLoginParams {
  readonly contactPoint: string;
  readonly encryptedPassword: string;
  readonly nonAscii: boolean;
  readonly aac: string;
  readonly waterfallId: string;
  readonly challengeNonce: string;
  readonly mid: string;
  readonly now: number;
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
    {
      client_input_params: {
        blocked_uids: [],
        aac: params.aac,
        sim_phones: [],
        aymh_accounts: [],
        network_bssid: null,
        secure_family_device_id: '',
        has_granted_read_contacts_permissions: 0,
        auth_secure_device_id: '',
        has_whatsapp_installed: 0,
        si_device_param_network_info: caaDeviceNetworkInfo(),
        password: params.encryptedPassword,
        sso_token_map_json_string: '',
        block_store_machine_id: '',
        ig_vetted_device_nonces: null,
        cloud_trust_token: null,
        event_flow: 'login_manual',
        password_contains_non_ascii: params.nonAscii ? 'true' : 'false',
        client_known_key_hash: '',
        sso_accounts_auth_data: [],
        encrypted_msisdn: '',
        has_granted_read_phone_permissions: 0,
        app_manager_id: '',
        should_show_nested_nta_from_aymh: 0,
        device_id: device.androidDeviceId,
        zero_balance_state: '',
        login_attempt_count: 1,
        machine_id: params.mid,
        flash_call_permission_status: {
          READ_PHONE_STATE: 'DENIED',
          READ_CALL_LOG: 'DENIED',
          ANSWER_PHONE_CALLS: 'DENIED',
        },
        accounts_list: [],
        gms_incoming_call_retriever_eligibility: 'eligible',
        family_device_id: device.phoneId,
        fb_ig_device_id: [],
        device_emails: [],
        try_num: 1,
        lois_settings: { lois_token: '' },
        event_step: 'home_page',
        headers_infra_flow_id: '',
        openid_tokens: {},
        contact_point: params.contactPoint,
      },
      server_params: {
        should_trigger_override_login_2fa_action: 0,
        is_from_logged_out: 0,
        should_trigger_override_login_success_action: 0,
        login_credential_type: 'none',
        server_login_source: 'login',
        waterfall_id: params.waterfallId,
        two_step_login_type: 'one_step_login',
        login_source: 'Login',
        is_platform_login: 0,
        login_entry_point: 'logged_out',
        INTERNAL__latency_qpl_marker_id: LATENCY_QPL_MARKER_ID,
        is_from_aymh: 0,
        offline_experiment_group: OFFLINE_EXPERIMENT_GROUP,
        is_from_landing_page: 0,
        left_nav_button_action: 'NONE',
        password_text_input_id: `${textInputId}:82`,
        is_from_empty_password: 0,
        is_from_msplit_fallback: 0,
        ar_event_source: 'login_home_page',
        qe_device_id: device.uuid,
        username_text_input_id: `${textInputId}:81`,
        layered_homepage_experiment_group: 'Deploy: Not in Experiment',
        device_id: device.androidDeviceId,
        login_surface: 'login_home',
        INTERNAL__latency_qpl_instance_id: params.now,
        reg_flow_source: 'login_home_native_integration_point',
        is_caa_perf_enabled: 1,
        credential_type: 'password',
        is_from_password_entry_page: 0,
        caller: 'gslr',
        family_device_id: device.phoneId,
        is_from_assistive_id: 0,
        access_flow_version: 'pre_mt_behavior',
        is_from_logged_in_switcher: 0,
      },
    },
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
 * authorization token. A two-factor response surfaces as a typed error; its
 * resolution is handled separately.
 */
export async function caaLogin(
  client: PrivateClient,
  credentials: CaaLoginCredentials,
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

  return applyCaaResult(client, result);
}

/** Applies a CAA send-login response: session on success, typed error otherwise. */
async function applyCaaResult(
  client: PrivateClient,
  result: PrivateResponseJson,
): Promise<PrivateResponseJson> {
  const bundle = extractLoginResponse(result);
  if (bundle === null) {
    if (allText(result).includes(AP_2SV_ENTRYPOINT)) {
      throw new TwoFactorRequiredError('Two-factor verification required', 200, { raw: result });
    }
    throw new IgError('CAA login did not return a session');
  }

  const authorization =
    bundle.headers['IG-Set-Authorization'] ?? bundle.headers['ig-set-authorization'];
  const userId = extractUserId(bundle.loginResponse);
  client.patchAuth({
    ...(authorization !== undefined && authorization !== '' ? { authorization } : {}),
    ...(userId !== undefined ? { userId, lastLogin: Date.now() } : {}),
    ...(Object.keys(bundle.cookies).length > 0 ? { cookies: bundle.cookies } : {}),
  });
  await client.persist();
  return bundle.loginResponse;
}
