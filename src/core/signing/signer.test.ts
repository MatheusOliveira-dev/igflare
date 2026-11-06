import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { hmacSignature, buildSignedBody, createHmacSigner } from './signer';

describe('hmacSignature', () => {
  it('matches a known golden vector', () => {
    expect(hmacSignature('key', 'payload')).toBe(
      '5d98b45c90a207fa998ce639fea6f02ecc8cc3f36fef81d694fb856b4d0a28ca',
    );
  });

  it('is deterministic and always a 64-char hex digest', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (key, payload) => {
        const first = hmacSignature(key, payload);
        const second = hmacSignature(key, payload);
        return first === second && /^[0-9a-f]{64}$/.test(first);
      }),
    );
  });
});

describe('buildSignedBody', () => {
  it('puts the signature before a dot and the payload after', () => {
    expect(buildSignedBody('key', 'payload')).toBe(`${hmacSignature('key', 'payload')}.payload`);
  });
});

describe('createHmacSigner', () => {
  it('signs through the port using the bound key', () => {
    const signer = createHmacSigner('key');
    expect(signer.sign('payload')).toBe(buildSignedBody('key', 'payload'));
  });
});
