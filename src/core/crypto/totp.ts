import { createHmac } from 'node:crypto';
import { IgError } from '../../errors/ig-error';

/** Code length, step and time for a TOTP code. The defaults match authenticator apps. */
export interface TotpOptions {
  /** Unix time in seconds. Defaults to now; injectable for tests. */
  readonly now?: number;
  /** Code length. Authenticator apps use 6. */
  readonly digits?: number;
  /** Time step in seconds. Authenticator apps use 30. */
  readonly period?: number;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decodes an RFC 4648 base32 secret. Authenticator setup screens show the key in
 * lowercase groups separated by spaces, so spaces, dashes and padding are ignored.
 */
function decodeBase32(secret: string): Buffer {
  const compact = secret.replace(/[\s-]/g, '').toUpperCase();
  let end = compact.length;
  while (end > 0 && compact.charAt(end - 1) === '=') {
    end -= 1;
  }
  const cleaned = compact.slice(0, end);
  if (cleaned === '') {
    throw new IgError('The TOTP secret is empty');
  }
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new IgError('The TOTP secret is not valid base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generates the current RFC 6238 time-based one-time password (HMAC-SHA1) for a
 * base32 secret, the same code an authenticator app shows. Uses node:crypto only.
 */
export function generateTotp(secret: string, options: TotpOptions = {}): string {
  const digits = options.digits ?? 6;
  const period = options.period ?? 30;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / period)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();

  // Dynamic truncation (RFC 4226 section 5.3): the low nibble of the last byte
  // picks the offset of a 31-bit window.
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const window =
    ((digest[offset] ?? 0) & 0x7f) * 2 ** 24 +
    (digest[offset + 1] ?? 0) * 2 ** 16 +
    (digest[offset + 2] ?? 0) * 2 ** 8 +
    (digest[offset + 3] ?? 0);
  return String(window % 10 ** digits).padStart(digits, '0');
}
