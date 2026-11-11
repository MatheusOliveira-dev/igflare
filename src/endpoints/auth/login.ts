import type { PrivateClient } from '../../core/http/private-client';
import { encryptPassword } from '../../core/crypto/password';
import type { PasswordPublicKey } from '../../core/crypto/password';
import { jazoest } from '../../core/signing/signer';
import { IgError } from '../../errors/ig-error';
import type { PrivateResponseJson } from '../../core/http/response';
import { endpoints } from '../../generated/endpoints';

/** The credentials for the older login endpoint. */
export interface LoginCredentials {
  readonly username: string;
  readonly password: string;
  /** Numeric calling code for the country_codes field. Defaults to '1' (US). */
  readonly countryCode?: string;
}

/** Fetches the current password encryption key from the launcher/sync headers. */
export async function fetchPasswordPublicKey(client: PrivateClient): Promise<PasswordPublicKey> {
  const response = await client.send({
    method: endpoints.launcherSync.method,
    endpoint: endpoints.launcherSync.path,
    payload: { id: client.session.device.uuid, server_config_retrieval: '1' },
    withDefaultData: false,
  });
  const keyId = response.headers['ig-set-password-encryption-key-id'];
  const publicKey = response.headers['ig-set-password-encryption-pub-key'];
  if (keyId === undefined || publicKey === undefined) {
    throw new IgError('Instagram did not return the password encryption key');
  }
  return { keyId: Number(keyId), publicKey };
}

function extractUserId(json: PrivateResponseJson): string | undefined {
  const user = json['logged_in_user'];
  if (typeof user === 'object' && user !== null && 'pk' in user) {
    const pk = user.pk;
    if (typeof pk === 'number' || typeof pk === 'string') {
      return String(pk);
    }
  }
  return undefined;
}

/** Applies a successful login response to the session and persists it. */
export async function finalizeLogin(
  client: PrivateClient,
  json: PrivateResponseJson,
): Promise<PrivateResponseJson> {
  const userId = extractUserId(json);
  if (userId !== undefined) {
    client.patchAuth({ userId, lastLogin: Date.now() });
    await client.persist();
  }
  return json;
}

/**
 * Logs in with username and password. On success the session carries the user id
 * and the authorization token, and is persisted if the client has a store.
 * Two-factor, challenge and bad-password responses surface as typed errors.
 */
export async function login(
  client: PrivateClient,
  credentials: LoginCredentials,
): Promise<PrivateResponseJson> {
  const publicKey = await fetchPasswordPublicKey(client);
  const { device } = client.session;

  const payload = {
    jazoest: jazoest(device.phoneId),
    country_codes: `[{"country_code":"${credentials.countryCode ?? '1'}","source":["default"]}]`,
    phone_id: device.phoneId,
    enc_password: encryptPassword(credentials.password, publicKey),
    username: credentials.username,
    adid: device.advertisingId,
    guid: device.uuid,
    device_id: device.androidDeviceId,
    google_tokens: '[]',
    login_attempt_count: '0',
  };

  const json = await client.request({
    method: endpoints.accountsLogin.method,
    endpoint: endpoints.accountsLogin.path,
    payload,
    withDefaultData: false,
  });

  return finalizeLogin(client, json);
}
