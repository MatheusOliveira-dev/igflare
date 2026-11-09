import { describe, it, expect } from 'vitest';
import { buildAttestationParams, ATTESTATION_KEYSTORE_ERROR } from './attestation';

describe('buildAttestationParams', () => {
  it('matches instagrapi for a known nonce (golden vector)', () => {
    expect(buildAttestationParams('NONCE123')).toBe(
      '{"attestation":[{"version":2,"type":"keystore","errors":[-1013],"challenge_nonce":"NONCE123","signed_nonce":"","key_hash":""}]}',
    );
  });

  it('returns an empty string when no nonce is known', () => {
    expect(buildAttestationParams('')).toBe('');
  });

  it('carries the keystore-unavailable error code', () => {
    const parsed = JSON.parse(buildAttestationParams('x')) as {
      attestation: { errors: number[] }[];
    };
    expect(parsed.attestation[0]?.errors).toEqual([ATTESTATION_KEYSTORE_ERROR]);
  });
});
