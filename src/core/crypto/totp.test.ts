import { describe, it, expect } from 'vitest';
import { generateTotp } from './totp';
import { IgError } from '../../errors/ig-error';

// RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890",
// whose base32 form is below. The RFC lists 8-digit codes. A 6-digit code is the
// same number modulo 10^6, which is what authenticator apps show.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('generateTotp', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 vector at t=%d (8 digits)', (now, expected) => {
    expect(generateTotp(RFC_SECRET, { now, digits: 8 })).toBe(expected);
  });

  it('produces the 6-digit authenticator code, keeping leading zeros', () => {
    expect(generateTotp(RFC_SECRET, { now: 59 })).toBe('287082');
    expect(generateTotp(RFC_SECRET, { now: 1111111109 })).toBe('081804');
  });

  it('holds the same code inside one 30-second window and changes in the next', () => {
    const a = generateTotp(RFC_SECRET, { now: 60 });
    expect(generateTotp(RFC_SECRET, { now: 89 })).toBe(a);
    expect(generateTotp(RFC_SECRET, { now: 90 })).not.toBe(a);
  });

  it('accepts the key as an authenticator app shows it: lowercase, spaced, padded', () => {
    const spaced = 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq';
    expect(generateTotp(spaced, { now: 59 })).toBe('287082');
    expect(generateTotp(`${RFC_SECRET}====`, { now: 59 })).toBe('287082');
  });

  it('rejects an empty or non-base32 secret', () => {
    expect(() => generateTotp('', { now: 59 })).toThrow(IgError);
    expect(() => generateTotp('not*base32!', { now: 59 })).toThrow(IgError);
  });

  it('defaults to the current time', () => {
    expect(generateTotp(RFC_SECRET)).toMatch(/^\d{6}$/);
  });
});
