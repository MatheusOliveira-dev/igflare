import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { quotePlus, buildSignedBody, jazoest, createSigner } from './signer';

describe('quotePlus', () => {
  it('encodes a space as a plus', () => {
    expect(quotePlus('b c')).toBe('b+c');
  });

  it('round-trips any JSON string', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const json = JSON.stringify(value);
        const decoded = decodeURIComponent(quotePlus(json).replace(/\+/g, ' '));
        return decoded === json;
      }),
    );
  });
});

describe('buildSignedBody', () => {
  it('matches a known golden vector', () => {
    expect(buildSignedBody('{"a":"b c","n":1}')).toBe(
      'signed_body=SIGNATURE.%7B%22a%22%3A%22b+c%22%2C%22n%22%3A1%7D',
    );
  });

  it('always starts with the signed_body prefix', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        return buildSignedBody(JSON.stringify(value)).startsWith('signed_body=SIGNATURE.');
      }),
    );
  });
});

describe('jazoest', () => {
  it('matches a known golden vector', () => {
    expect(jazoest('4cf2a3f0-1111-2222-3333-abcdef012345')).toBe('22281');
  });
});

describe('createSigner', () => {
  it('signs through the port', () => {
    expect(createSigner().sign('{"a":1}')).toBe(buildSignedBody('{"a":1}'));
  });
});
