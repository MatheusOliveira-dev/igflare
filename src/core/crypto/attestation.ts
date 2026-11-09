/**
 * The error code the app reports when the hardware keystore attestation is
 * unavailable. The CAA login flow accepts this degraded state, so the client
 * presents it instead of a real hardware-backed attestation.
 */
export const ATTESTATION_KEYSTORE_ERROR = -1013;

/**
 * Builds the `X-IG-Attest-Params` value sent during CAA login: a single
 * keystore attestation entry in the accepted "unavailable" state, carrying the
 * server-issued challenge nonce. Returns an empty string when no nonce is known
 * (the server has not been asked for one yet).
 */
export function buildAttestationParams(challengeNonce: string): string {
  if (!challengeNonce) {
    return '';
  }
  return JSON.stringify({
    attestation: [
      {
        version: 2,
        type: 'keystore',
        errors: [ATTESTATION_KEYSTORE_ERROR],
        challenge_nonce: challengeNonce,
        signed_nonce: '',
        key_hash: '',
      },
    ],
  });
}
