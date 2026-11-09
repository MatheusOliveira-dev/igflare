export interface BuildBloksPayloadOptions {
  readonly uuid: string;
  readonly bloksVersioningId: string;
}

/**
 * Builds the Bloks request body fields: the action `params` as compact JSON, the
 * device uuid, the client context, and the Bloks versioning id. Pure: no network.
 */
export function buildBloksPayload(
  params: Record<string, unknown>,
  options: BuildBloksPayloadOptions,
): Record<string, string> {
  return {
    params: JSON.stringify(params),
    _uuid: options.uuid,
    bk_client_context: JSON.stringify({
      bloks_version: options.bloksVersioningId,
      styles_id: 'instagram',
    }),
    bloks_versioning_id: options.bloksVersioningId,
  };
}

/**
 * The device network signals the CAA login params include. These are the stable
 * values the current Android flow sends; they describe a single-SIM device on
 * wifi and are not derived from the real connection.
 */
export function caaDeviceNetworkInfo(): Record<string, unknown> {
  return {
    active_subscriptions_info: null,
    default_subscription_info: {
      network_type: null,
      is_data_roaming: 1,
      is_esim: null,
      is_gsm_roaming: 0,
      is_sim_sms_capable: null,
      is_mobile_data_enabled: 1,
      sim_carrier_id: 1,
      sim_carrier_id_name: null,
      sim_state: 5,
      sim_operator: '310260',
      sim_operator_name: 'T-Mobile',
      signal_strength: null,
      group_id_level_1: null,
      network_operator: '310260',
    },
    is_airplane_mode: 0,
    is_active_network_cellular: 0,
    is_device_sms_capable: 1,
    sim_count: 1,
    is_wifi: 1,
  };
}
