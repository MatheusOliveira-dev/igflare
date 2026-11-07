import { describe, it, expect } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, createDeviceState } from './device';
import { buildBaseHeaders } from './headers';

const device = createDeviceState({
  uuid: '11111111-1111-4111-8111-111111111111',
  phoneId: '22222222-2222-4222-8222-222222222222',
  androidDeviceId: 'android-f749eebdc6474685',
  pigeonSessionId: 'UFS-33333333-3333-4333-8333-333333333333-1',
});

describe('buildBaseHeaders', () => {
  it('maps the device and profile into the stable headers', () => {
    const headers = buildBaseHeaders({ profile: DEFAULT_DEVICE_PROFILE, device });
    expect(headers['X-IG-Device-ID']).toBe(device.uuid);
    expect(headers['X-IG-Family-Device-ID']).toBe(device.phoneId);
    expect(headers['X-IG-Android-ID']).toBe(device.androidDeviceId);
    expect(headers['X-IG-App-ID']).toBe('567067343352427');
    expect(headers['X-IG-Capabilities']).toBe('3brTv10=');
    expect(headers['X-Bloks-Version-Id']).toBe(DEFAULT_DEVICE_PROFILE.bloksVersioningId);
    expect(headers['X-IG-WWW-Claim']).toBe('0');
    expect(headers['IG-INTENDED-USER-ID']).toBe('0');
    expect(headers['User-Agent']).toContain('Instagram 449.0.0.52.84');
  });

  it('defaults Accept-Language to en-US and prepends another locale', () => {
    const base = buildBaseHeaders({ profile: DEFAULT_DEVICE_PROFILE, device });
    expect(base['Accept-Language']).toBe('en-US');
    const ptBr = buildBaseHeaders({ profile: DEFAULT_DEVICE_PROFILE, device, locale: 'pt_BR' });
    expect(ptBr['Accept-Language']).toBe('pt-BR, en-US');
  });

  it('adds the authenticated headers only when a user id is present', () => {
    const anon = buildBaseHeaders({ profile: DEFAULT_DEVICE_PROFILE, device });
    expect(anon['IG-U-DS-USER-ID']).toBeUndefined();
    expect(anon['Authorization']).toBeUndefined();

    const authed = buildBaseHeaders({
      profile: DEFAULT_DEVICE_PROFILE,
      device,
      userId: '42',
      authorization: 'Bearer token',
      mid: 'abc',
    });
    expect(authed['IG-U-DS-USER-ID']).toBe('42');
    expect(authed['IG-INTENDED-USER-ID']).toBe('42');
    expect(authed['Authorization']).toBe('Bearer token');
    expect(authed['X-MID']).toBe('abc');
  });
});
