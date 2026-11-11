import { describe, expect, it } from 'vitest';
import { isRecord, readCursor } from './guards';

describe('isRecord', () => {
  it('accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});

describe('readCursor', () => {
  it('returns strings and stringified numbers', () => {
    expect(readCursor({ k: 'abc' }, 'k')).toBe('abc');
    expect(readCursor({ k: 42 }, 'k')).toBe('42');
  });

  it('returns undefined when absent or of another type', () => {
    expect(readCursor({}, 'k')).toBeUndefined();
    expect(readCursor({ k: null }, 'k')).toBeUndefined();
    expect(readCursor({ k: true }, 'k')).toBeUndefined();
  });
});
