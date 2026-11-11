import { randomInt } from 'node:crypto';

/**
 * The 19-digit numeric token the app attaches to direct mutations as its client
 * context. It only has to be unique per action.
 */
export function mutationToken(): string {
  return `68000${String(randomInt(11_111_111_111_111, 99_999_999_999_999))}`;
}

/**
 * A JSON array of numeric ids built by hand: ids are 64-bit (a thread id has 39
 * digits), and going through a JS number would silently round them.
 */
export function numericIdArray(ids: readonly string[]): string {
  return `[${ids.join(',')}]`;
}
