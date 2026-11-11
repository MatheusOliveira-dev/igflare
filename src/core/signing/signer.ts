/**
 * Builds the signed payload the private API expects. Isolated on purpose: this
 * is the layer most likely to change, so everything that signs goes through this
 * port and is pinned by golden vectors.
 *
 * The app no longer HMACs the body. It sends `signed_body=SIGNATURE.<payload>`
 * with the payload url-encoded the way Python's `urllib.parse.quote_plus` does
 * (space becomes `+`), which is what the reference client produces.
 */
export interface Signer {
  /** The body to send for a payload. */
  sign(payload: string): string;
}

/** Matches Python's `urllib.parse.quote_plus`: unreserved kept, space as `+`. */
export function quotePlus(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!*'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

/** The `signed_body=SIGNATURE.<json>` form body the app sends. */
export function buildSignedBody(payload: string): string {
  return `signed_body=SIGNATURE.${quotePlus(payload)}`;
}

/** The login anti-automation parameter: `2` followed by the sum of char codes. */
export function jazoest(value: string): string {
  let sum = 0;
  for (const char of value) {
    // for...of yields non-empty characters, so the fallback is unreachable.
    /* v8 ignore next */
    sum += char.codePointAt(0) ?? 0;
  }
  return `2${String(sum)}`;
}

/** The default signer, which builds the signed body. */
export function createSigner(): Signer {
  return { sign: buildSignedBody };
}
