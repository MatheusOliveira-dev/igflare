import {
  createSign,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';

/**
 * The local P-256 signing identity behind the `X-Meta-Usdid` header and the
 * USDID registration token the current Android app presents during CAA login.
 * The private key never leaves the client; only signatures and the public key
 * are sent. Persist these fields to keep one stable identity across logins.
 */
export interface UsdidIdentity {
  /** The user-scoped device id (a uuid v4). */
  readonly usdid: string;
  /** The key id advertised in the registration token header (`kid`). */
  readonly kid: string;
  /** The P-256 private key, PKCS#8 PEM. */
  readonly privateKeyPem: string;
}

export interface GenerateUsdidOptions {
  readonly usdid?: string;
  readonly kid?: string;
  readonly privateKeyPem?: string;
}

/** URL-safe base64 with the padding stripped, as the app encodes these values. */
export function base64url(raw: Buffer): string {
  return raw.toString('base64url');
}

/** Generates (or restores, via overrides) a USDID identity. */
export function generateUsdidIdentity(options: GenerateUsdidOptions = {}): UsdidIdentity {
  const privateKeyPem =
    options.privateKeyPem ??
    generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    });

  return {
    usdid: options.usdid ?? randomUUID(),
    kid: options.kid ?? base64url(randomBytes(32)),
    privateKeyPem,
  };
}

/** The DER SubjectPublicKeyInfo for the identity's public key. */
export function usdidPublicKeyDer(identity: UsdidIdentity): Buffer {
  return createPublicKey(identity.privateKeyPem).export({ type: 'spki', format: 'der' });
}

/** Signs a message with the identity key: ECDSA over SHA-256, DER-encoded. */
export function signUsdid(identity: UsdidIdentity, message: string): Buffer {
  return createSign('SHA256')
    .update(message, 'utf8')
    .end()
    .sign({ key: identity.privateKeyPem, dsaEncoding: 'der' });
}

export interface UsdidHeaderOptions {
  readonly now?: number;
  readonly ttl?: number;
}

/** The token time-to-live the app uses for USDID material, in seconds. */
export const USDID_TOKEN_TTL = 3600;

/**
 * Builds the three-part signed `X-Meta-Usdid` value: `<usdid>.<expiresAt>.<sig>`,
 * where the signature covers `<usdid>.<expiresAt>`.
 */
export function buildUsdidHeader(
  identity: UsdidIdentity,
  options: UsdidHeaderOptions = {},
): string {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const expiresAt = now + (options.ttl ?? USDID_TOKEN_TTL);
  const signedPart = `${identity.usdid}.${String(expiresAt)}`;
  return `${signedPart}.${base64url(signUsdid(identity, signedPart))}`;
}

export interface RegistrationTokenOptions {
  readonly appId: string;
  readonly now?: number;
  readonly ttl?: number;
}

/**
 * Builds the ES256 registration token the app sends to register its USDID public
 * key: a JWS-shaped envelope, itself base64url-encoded.
 */
export function buildUsdidRegistrationToken(
  identity: UsdidIdentity,
  options: RegistrationTokenOptions,
): string {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const exp = now + (options.ttl ?? USDID_TOKEN_TTL);

  const payload = base64url(
    Buffer.from(
      JSON.stringify({
        sub: identity.usdid,
        iat: now,
        aud: options.appId,
        exp,
        pub: usdidPublicKeyDer(identity).toString('base64'),
        alg: 'ES256',
      }),
      'utf8',
    ),
  );
  const protectedHeader = base64url(
    Buffer.from(
      JSON.stringify({
        typ: 'JWT',
        alg: 'ES256',
        kid: identity.kid,
        aid: options.appId,
        ver: '1',
      }),
      'utf8',
    ),
  );

  const token = {
    payload,
    signatures: [
      {
        protected: protectedHeader,
        signature: base64url(signUsdid(identity, `${protectedHeader}.${payload}`)),
      },
    ],
  };
  return base64url(Buffer.from(JSON.stringify(token), 'utf8'));
}
