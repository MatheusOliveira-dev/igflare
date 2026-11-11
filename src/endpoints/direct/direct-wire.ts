import { randomInt } from 'node:crypto';
import { IgError } from '../../errors/ig-error';

/**
 * The 19-digit numeric token the app attaches to direct mutations as its client
 * context. It only has to be unique per action.
 */
export function mutationToken(): string {
  return `68000${String(randomInt(11_111_111_111_111, 99_999_999_999_999))}`;
}

/** Rejects anything that is not a plain numeric id, so a path or body cannot be forged. */
export function assertIds(ids: readonly string[], what: string): void {
  if (ids.length === 0 || ids.some((id) => !/^\d+$/.test(id))) {
    throw new IgError(`${what} must be a non-empty list of numeric ids`);
  }
}

/**
 * A JSON array of numeric ids built by hand: ids are 64-bit (a thread id has 39
 * digits), and going through a JS number would silently round them.
 */
export function numericIdArray(ids: readonly string[]): string {
  return `[${ids.join(',')}]`;
}
