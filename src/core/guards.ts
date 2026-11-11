/** True for a plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a next-page cursor from a list response. The server sends it as a string or,
 * on some endpoints, a bare number; an absent or other-typed value means the last page.
 */
export function readCursor(json: Record<string, unknown>, key: string): string | undefined {
  const value = json[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
