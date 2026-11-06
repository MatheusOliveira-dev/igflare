import { createHmac } from 'node:crypto';

/**
 * Produces the signed payload the private API expects. Isolated on purpose:
 * this is the layer most likely to change, so everything that signs goes
 * through this port and is pinned by golden vectors.
 */
export interface Signer {
  sign(payload: string): string;
}

/** HMAC-SHA256 of `payload` keyed by `key`, as a lowercase hex digest. */
export function hmacSignature(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

/** The `signed_body` form: the signature, a dot, then the raw payload. */
export function buildSignedBody(key: string, payload: string): string {
  return `${hmacSignature(key, payload)}.${payload}`;
}

export function createHmacSigner(key: string): Signer {
  return { sign: (payload) => buildSignedBody(key, payload) };
}
