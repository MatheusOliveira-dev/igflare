import { publicEncrypt, randomBytes, createCipheriv, constants } from 'node:crypto';

/** The server key the password is encrypted for, as login hands it out. */
export interface PasswordPublicKey {
  readonly keyId: number;
  /** The public key as Instagram sends it: base64 of a PEM document. */
  readonly publicKey: string;
}

/** Inputs for encrypting a password the way the app does before login. */
export interface EncryptPasswordOptions {
  readonly sessionKey?: Buffer;
  readonly iv?: Buffer;
  readonly timestamp?: number;
}

/**
 * Encrypts a password the way the app does: an RSA-wrapped AES-256-GCM session
 * key over the password, packed as `#PWD_INSTAGRAM:4:<ts>:<base64>`. The public
 * key comes from the launcher/sync response headers.
 */
export function encryptPassword(
  password: string,
  key: PasswordPublicKey,
  options: EncryptPasswordOptions = {},
): string {
  const sessionKey = options.sessionKey ?? randomBytes(32);
  const iv = options.iv ?? randomBytes(12);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));

  const pem = Buffer.from(key.publicKey, 'base64').toString('utf8');
  const rsaEncrypted = publicEncrypt(
    { key: pem, padding: constants.RSA_PKCS1_PADDING },
    sessionKey,
  );

  const cipher = createCipheriv('aes-256-gcm', sessionKey, iv);
  cipher.setAAD(Buffer.from(timestamp, 'utf8'));
  const aesEncrypted = Buffer.concat([
    cipher.update(Buffer.from(password, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const sizeBuffer = Buffer.alloc(2);
  sizeBuffer.writeUInt16LE(rsaEncrypted.length, 0);

  const payload = Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from([key.keyId]),
    iv,
    sizeBuffer,
    rsaEncrypted,
    tag,
    aesEncrypted,
  ]).toString('base64');

  return `#PWD_INSTAGRAM:4:${timestamp}:${payload}`;
}
