import { describe, it, expect } from 'vitest';
import {
  generateKeyPairSync,
  privateDecrypt,
  createDecipheriv,
  constants,
  type KeyObject,
} from 'node:crypto';
import { encryptPassword, type PasswordPublicKey } from './password';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const key: PasswordPublicKey = {
  keyId: 173,
  publicKey: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
};

function decryptPassword(encrypted: string, rsaPrivateKey: KeyObject): string {
  const payloadB64 = encrypted.split(':')[3] ?? '';
  const payload = Buffer.from(payloadB64, 'base64');
  let offset = 2; // 0x01 version, then the key id
  const iv = payload.subarray(offset, offset + 12);
  offset += 12;
  const size = payload.readUInt16LE(offset);
  offset += 2;
  const rsaEncrypted = payload.subarray(offset, offset + size);
  offset += size;
  const tag = payload.subarray(offset, offset + 16);
  offset += 16;
  const aesEncrypted = payload.subarray(offset);

  const sessionKey = privateDecrypt(
    { key: rsaPrivateKey, padding: constants.RSA_PKCS1_PADDING },
    rsaEncrypted,
  );
  const timestamp = encrypted.split(':')[2] ?? '';
  const decipher = createDecipheriv('aes-256-gcm', sessionKey, iv);
  decipher.setAAD(Buffer.from(timestamp, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(aesEncrypted), decipher.final()]).toString('utf8');
}

describe('encryptPassword', () => {
  it('produces the #PWD_INSTAGRAM:4 envelope with the given timestamp', () => {
    const out = encryptPassword('hunter2', key, { timestamp: 1_700_000_000 });
    expect(out.startsWith('#PWD_INSTAGRAM:4:1700000000:')).toBe(true);
  });

  it('round-trips: the receiver recovers the original password', () => {
    const out = encryptPassword('correct horse battery staple', key);
    expect(decryptPassword(out, privateKey)).toBe('correct horse battery staple');
  });

  it('uses the supplied session key and iv', () => {
    const sessionKey = Buffer.alloc(32, 7);
    const iv = Buffer.alloc(12, 9);
    const out = encryptPassword('pw', key, { sessionKey, iv, timestamp: 1 });
    const payload = Buffer.from(out.split(':')[3] ?? '', 'base64');
    expect(payload.subarray(2, 14).equals(iv)).toBe(true);
    expect(decryptPassword(out, privateKey)).toBe('pw');
  });

  it('carries the key id in the payload', () => {
    const out = encryptPassword('x', key, { timestamp: 1 });
    const payload = Buffer.from(out.split(':')[3] ?? '', 'base64');
    expect(payload[0]).toBe(0x01);
    expect(payload[1]).toBe(173);
  });
});
