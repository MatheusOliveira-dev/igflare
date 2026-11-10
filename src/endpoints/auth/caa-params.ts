import type { DeviceState } from '../../core/transport/device';
import { caaDeviceNetworkInfo } from '../../core/bloks/payload';

/**
 * The large Bloks parameter maps the CAA login steps send. They are kept here,
 * apart from the flow that orchestrates them, so a field change is a localized
 * edit to typed data rather than a hunt through the request code. Every value is
 * ported verbatim from the reference Android capture; the non-obvious constants
 * are documented at their definition.
 */

/** The domain the CAA/Bloks login flow talks to. */
export const CAA_API_DOMAIN = 'b.i.instagram.com';

/**
 * The offline experiment bucket the current app build reports on every CAA step.
 * It is an opaque server-side cohort label from the capture, sent unchanged.
 */
const OFFLINE_EXPERIMENT_GROUP = 'caa_iteration_v3_perf_ig_4';

/**
 * The QPL (Quick Performance Logger) marker id for the login latency trace. The
 * server reads it only for telemetry, but the app always sends this exact id for
 * the login flow, so it is reproduced rather than randomized.
 */
const LATENCY_QPL_MARKER_ID = 36707139;

/** The static homepage experiment label the flow is not enrolled in. */
const HOMEPAGE_EXPERIMENT = 'Deploy: Not in Experiment';

export interface SendLoginParams {
  readonly contactPoint: string;
  readonly encryptedPassword: string;
  readonly nonAscii: boolean;
  readonly aac: string;
  readonly waterfallId: string;
  readonly challengeNonce: string;
  readonly mid: string;
  readonly now: number;
}

/** Params for `process_client_data_and_redirect`: opens the logged-out homepage. */
export function buildProcessClientDataParams(
  device: DeviceState,
  waterfallId: string,
): Record<string, unknown> {
  return {
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
    layered_homepage_experiment_group: HOMEPAGE_EXPERIMENT,
    launched_url: '',
    sim_phone_numbers: [],
    is_from_registration_reminder: false,
  };
}

export interface OauthTokenFetchInput {
  readonly username: string;
  readonly aac: string;
  readonly waterfallId: string;
  readonly now: number;
}

/** Params for the `oauth.token.fetch` preflight, sent before the credentials. */
export function buildOauthTokenFetchParams(
  device: DeviceState,
  input: OauthTokenFetchInput,
): Record<string, unknown> {
  return {
    client_input_params: {
      username_input: input.username,
      si_device_param_network_info: caaDeviceNetworkInfo(),
      aac: input.aac,
      lois_settings: { lois_token: '' },
      cloud_trust_token: null,
      zero_balance_state: '',
      network_bssid: null,
    },
    server_params: {
      is_from_logged_out: 0,
      layered_homepage_experiment_group: HOMEPAGE_EXPERIMENT,
      device_id: device.androidDeviceId,
      login_surface: 'login_home',
      waterfall_id: input.waterfallId,
      INTERNAL__latency_qpl_instance_id: input.now,
      is_platform_login: 0,
      login_entry_point: 'logged_out',
      INTERNAL__latency_qpl_marker_id: LATENCY_QPL_MARKER_ID,
      family_device_id: device.phoneId,
      offline_experiment_group: OFFLINE_EXPERIMENT_GROUP,
      access_flow_version: 'pre_mt_behavior',
      is_from_logged_in_switcher: 0,
      qe_device_id: device.uuid,
    },
  };
}

/**
 * Params for `send_login_request`: the encrypted password and the device state.
 * `textInputId` is the per-request id the app assigns to the on-screen fields;
 * the `:81`/`:82` suffixes are the Bloks component ids for the username and
 * password text inputs respectively, which the server echoes back for the trace.
 */
export function buildSendLoginParams(
  device: DeviceState,
  params: SendLoginParams,
  textInputId: string,
): Record<string, unknown> {
  return {
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
      layered_homepage_experiment_group: HOMEPAGE_EXPERIMENT,
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
  };
}

/** Params that open the two-factor entrypoint, echoing the context the login returned. */
export function buildTwoFactorEntrypointParams(
  device: DeviceState,
  machineId: string,
  contextData: string,
  now: number,
): Record<string, unknown> {
  return {
    client_input_params: {
      auth_secure_device_id: '',
      accounts_list: [],
      has_whatsapp_installed: 0,
      family_device_id: device.phoneId,
      machine_id: machineId,
    },
    server_params: {
      use_open_instead_of_push: 0,
      context_data: contextData,
      INTERNAL__latency_qpl_marker_id: LATENCY_QPL_MARKER_ID,
      INTERNAL__latency_qpl_instance_id: now,
      device_id: device.uuid,
      use_close_instead_of_back: 0,
    },
  };
}

/** Params that open the code-entry screen and obtain the submit context. */
export function buildTwoFactorCodeEntryParams(
  device: DeviceState,
  aac: string,
  contextData: string,
): Record<string, unknown> {
  return {
    client_input_params: { aac },
    server_params: {
      context_data: contextData,
      show_close_button: 0,
      device_id: device.uuid,
      INTERNAL_INFRA_screen_id: 'generic_code_entry',
      is_dismissable: 1,
    },
  };
}

export interface TwoFactorSubmitInput {
  readonly aac: string;
  readonly code: string;
  readonly machineId: string;
  readonly contextData: string;
  readonly now: number;
}

/** Params that submit the one-time code and return the terminal login response. */
export function buildTwoFactorSubmitParams(
  device: DeviceState,
  input: TwoFactorSubmitInput,
): Record<string, unknown> {
  return {
    client_input_params: {
      auth_secure_device_id: '',
      aac: input.aac,
      code: input.code,
      family_device_id: device.phoneId,
      device_id: device.androidDeviceId,
      machine_id: input.machineId,
    },
    server_params: {
      context_data: input.contextData,
      INTERNAL__latency_qpl_marker_id: LATENCY_QPL_MARKER_ID,
      INTERNAL__latency_qpl_instance_id: input.now,
      device_id: device.uuid,
    },
  };
}
