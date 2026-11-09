import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  generateUuid,
  generateAndroidDeviceId,
  createDeviceState,
  buildUserAgent,
} from './device';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateUuid', () => {
  it('produces a v4 uuid', () => {
    expect(generateUuid()).toMatch(UUID_V4);
  });
});

describe('generateAndroidDeviceId', () => {
  it('matches a golden vector for a fixed seed', () => {
    expect(generateAndroidDeviceId('device-seed')).toBe('android-f749eebdc6474685');
  });

  it('has the android-<16 hex> shape', () => {
    expect(generateAndroidDeviceId()).toMatch(/^android-[0-9a-f]{16}$/);
  });
});

describe('createDeviceState', () => {
  it('fills every id with a valid uuid and the pigeon/android shapes', () => {
    const state = createDeviceState();
    expect(state.uuid).toMatch(UUID_V4);
    expect(state.phoneId).toMatch(UUID_V4);
    expect(state.pigeonSessionId).toMatch(/^UFS-[0-9a-f-]{36}-1$/);
    expect(state.androidDeviceId).toMatch(/^android-[0-9a-f]{16}$/);
  });

  it('restores supplied ids instead of generating them', () => {
    const state = createDeviceState({
      uuid: 'fixed-uuid',
      androidDeviceId: 'android-0000000000000000',
    });
    expect(state.uuid).toBe('fixed-uuid');
    expect(state.androidDeviceId).toBe('android-0000000000000000');
    expect(state.phoneId).toMatch(UUID_V4);
  });
});

describe('buildUserAgent', () => {
  it('matches a golden vector for the default profile', () => {
    expect(buildUserAgent(DEFAULT_DEVICE_PROFILE)).toBe(
      'Instagram 454.0.0.54.77 Android (34/14; 480dpi; 1344x2992; Google/google; Pixel 8 Pro; husky; husky; en_US; 1105698528)',
    );
  });
});
