import { IgError } from '../errors/ig-error';

/**
 * Ids end up inside URL paths, so anything but digits is refused before a request is
 * built: a value like `1/../accounts/logout` would otherwise rewrite the path.
 */
export function checkedId(value: string, what = 'An id'): string {
  if (!/^\d+$/.test(value)) {
    throw new IgError(`${what} must be a numeric id`);
  }
  return value;
}

/** A media id, either the bare pk (`123`) or the pk with its author (`123_456`). */
export function checkedMediaId(value: string): string {
  if (!/^\d+(_\d+)?$/.test(value)) {
    throw new IgError('A media id looks like 123456 or 123456_789');
  }
  return value;
}
