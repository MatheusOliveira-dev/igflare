import { describe, it, expect } from 'vitest';
import { createPublicKey, createVerify } from 'node:crypto';
import {
  base64url,
  generateUsdidIdentity,
  usdidPublicKeyDer,
  signUsdid,
  buildUsdidHeader,
  buildUsdidRegistrationToken,
  USDID_TOKEN_TTL,
  type UsdidIdentity,
} from './usdid';

const identity: UsdidIdentity = generateUsdidIdentity();

function verify(id: UsdidIdentity, message: string, signature: Buffer): boolean {
  return createVerify('SHA256')
    .update(message, 'utf8')
    .end()
    .verify({ key: createPublicKey(id.privateKeyPem), dsaEncoding: 'der' }, signature);
}

function b64urlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

describe('base64url', () => {
  it('matches the app encoding, with padding stripped', () => {
    expect(base64url(Buffer.from('abc', 'utf8'))).toBe('YWJj');
    expect(base64url(Buffer.from([0xff, 0xfe, 0xfd]))).toBe('__79');
  });

  it('encodes the same bytes as Python urlsafe_b64encode().rstrip("=")', () => {
    // Golden strings captured from instagrapi's helpers over fixed dicts.
    const protectedObj = {
      typ: 'JWT',
      alg: 'ES256',
      kid: 'KID1',
      aid: '567067343352427',
      ver: '1',
    };
    const payloadObj = {
      sub: 'uuid-x',
      iat: 1700000000,
      aud: '567067343352427',
      exp: 1700003600,
      pub: 'UFVCS0VZ',
      alg: 'ES256',
    };
    expect(base64url(Buffer.from(JSON.stringify(protectedObj), 'utf8'))).toBe(
      'eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiIsImtpZCI6IktJRDEiLCJhaWQiOiI1NjcwNjczNDMzNTI0MjciLCJ2ZXIiOiIxIn0',
    );
    expect(base64url(Buffer.from(JSON.stringify(payloadObj), 'utf8'))).toBe(
      'eyJzdWIiOiJ1dWlkLXgiLCJpYXQiOjE3MDAwMDAwMDAsImF1ZCI6IjU2NzA2NzM0MzM1MjQyNyIsImV4cCI6MTcwMDAwMzYwMCwicHViIjoiVUZWQ1MwVloiLCJhbGciOiJFUzI1NiJ9',
    );
  });
});

describe('generateUsdidIdentity', () => {
  it('creates a uuid, a 32-byte kid and a P-256 key', () => {
    const id = generateUsdidIdentity();
    expect(id.usdid).toMatch(/^[0-9a-f-]{36}$/);
    expect(b64urlDecode(id.kid)).toHaveLength(32);
    expect(id.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    // DER SPKI for a P-256 key is 91 bytes.
    expect(usdidPublicKeyDer(id)).toHaveLength(91);
  });

  it('restores a given identity from overrides', () => {
    const id = generateUsdidIdentity({
      usdid: identity.usdid,
      kid: identity.kid,
      privateKeyPem: identity.privateKeyPem,
    });
    expect(id).toEqual(identity);
  });
});

describe('signUsdid', () => {
  it('produces a signature the matching public key verifies', () => {
    const signature = signUsdid(identity, 'hello.1700000000');
    expect(verify(identity, 'hello.1700000000', signature)).toBe(true);
    expect(verify(identity, 'tampered', signature)).toBe(false);
  });
});

describe('buildUsdidHeader', () => {
  it('is <usdid>.<expiresAt>.<sig> and self-verifies', () => {
    const header = buildUsdidHeader(identity, { now: 1700000000, ttl: 3600 });
    const parts = header.split('.');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe(identity.usdid);
    expect(parts[1]).toBe('1700003600');
    expect(verify(identity, `${identity.usdid}.1700003600`, b64urlDecode(parts[2] ?? ''))).toBe(
      true,
    );
  });

  it('defaults the ttl to the app value', () => {
    const header = buildUsdidHeader(identity, { now: 1700000000 });
    expect(header.split('.')[1]).toBe(String(1700000000 + USDID_TOKEN_TTL));
  });
});

describe('buildUsdidRegistrationToken', () => {
  it('is a verifiable JWS envelope carrying the expected claims', () => {
    const token = buildUsdidRegistrationToken(identity, {
      appId: '567067343352427',
      now: 1700000000,
      ttl: 3600,
    });
    const envelope = JSON.parse(b64urlDecode(token).toString('utf8')) as {
      payload: string;
      signatures: { protected: string; signature: string }[];
    };

    const claims = JSON.parse(b64urlDecode(envelope.payload).toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(claims).toMatchObject({
      sub: identity.usdid,
      iat: 1700000000,
      aud: '567067343352427',
      exp: 1700003600,
      alg: 'ES256',
      pub: usdidPublicKeyDer(identity).toString('base64'),
    });

    const sig = envelope.signatures[0];
    expect(sig).toBeDefined();
    const header = JSON.parse(b64urlDecode(sig?.protected ?? '').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(header).toMatchObject({
      typ: 'JWT',
      alg: 'ES256',
      kid: identity.kid,
      aid: '567067343352427',
      ver: '1',
    });
    expect(
      verify(
        identity,
        `${sig?.protected ?? ''}.${envelope.payload}`,
        b64urlDecode(sig?.signature ?? ''),
      ),
    ).toBe(true);
  });
});
