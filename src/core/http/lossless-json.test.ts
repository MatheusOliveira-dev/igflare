import { describe, it, expect } from 'vitest';
import { parseLosslessJson } from './lossless-json';

describe('parseLosslessJson', () => {
  it('keeps a 64-bit integer id exact as a string', () => {
    const out = parseLosslessJson('{"pk":4000000000000000001}') as { pk: unknown };
    expect(out.pk).toBe('4000000000000000001');
  });

  it('leaves small integers and floats as numbers', () => {
    const out = parseLosslessJson('{"n":42,"x":1.5,"y":2e9,"z":-7}') as Record<string, unknown>;
    expect(out).toEqual({ n: 42, x: 1.5, y: 2e9, z: -7 });
  });

  it('does not quote a safe 16-digit integer that round-trips', () => {
    const out = parseLosslessJson('{"a":1000000000000000}') as { a: unknown };
    expect(out.a).toBe(1000000000000000);
  });

  it('never touches digits inside string values', () => {
    const out = parseLosslessJson('{"t":"has 4000000000000000001 in it"}') as { t: unknown };
    expect(out.t).toBe('has 4000000000000000001 in it');
  });

  it('handles escaped quotes before a big integer', () => {
    const out = parseLosslessJson(
      '{"a":"he said \\"hi\\" 12345678901234567890","b":12345678901234567890}',
    ) as { a: unknown; b: unknown };
    expect(out.a).toBe('he said "hi" 12345678901234567890');
    expect(out.b).toBe('12345678901234567890');
  });

  it('preserves big ids inside arrays and keeps composite string ids intact', () => {
    const out = parseLosslessJson(
      '{"ids":[4000000000000000001,10],"id":"4000000000000000001_10000000002"}',
    ) as { ids: unknown[]; id: unknown };
    expect(out.ids).toEqual(['4000000000000000001', 10]);
    expect(out.id).toBe('4000000000000000001_10000000002');
  });

  it('quotes a negative 64-bit integer', () => {
    const out = parseLosslessJson('{"a":-4000000000000000001}') as { a: unknown };
    expect(out.a).toBe('-4000000000000000001');
  });
});
