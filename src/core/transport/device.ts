import { createHash, randomUUID } from 'node:crypto';

/** The hardware/system/app profile the client presents as. Stable per install. */
export interface DeviceProfile {
  readonly appVersion: string;
  readonly versionCode: string;
  readonly bloksVersioningId: string;
  readonly androidVersion: number;
  readonly androidRelease: string;
  readonly dpi: string;
  readonly resolution: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly device: string;
  readonly cpu: string;
  readonly appId: string;
  readonly capabilities: string;
}

export const DEFAULT_DEVICE_PROFILE: DeviceProfile = {
  appVersion: '454.0.0.54.77',
  versionCode: '1105698528',
  bloksVersioningId: '8e8a63073c08f2c7e6701e497d777db5d8d7ad32a5788ce6b1094f20cad0c9f1',
  androidVersion: 34,
  androidRelease: '14',
  dpi: '480dpi',
  resolution: '1344x2992',
  manufacturer: 'Google/google',
  model: 'Pixel 8 Pro',
  device: 'husky',
  cpu: 'husky',
  appId: '567067343352427',
  capabilities: '3brTv10C',
};

/** The random per-install identifiers. Persist these to keep one logical device. */
export interface DeviceState {
  readonly uuid: string;
  readonly phoneId: string;
  readonly clientSessionId: string;
  readonly advertisingId: string;
  readonly requestId: string;
  readonly traySessionId: string;
  readonly pigeonSessionId: string;
  readonly androidDeviceId: string;
}

export function generateUuid(): string {
  return randomUUID();
}

export function generateAndroidDeviceId(seed: string = randomUUID()): string {
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 16);
  return `android-${hash}`;
}

/** Generates a fresh device state. Pass saved ids in `overrides` to restore one. */
export function createDeviceState(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    uuid: overrides.uuid ?? generateUuid(),
    phoneId: overrides.phoneId ?? generateUuid(),
    clientSessionId: overrides.clientSessionId ?? generateUuid(),
    advertisingId: overrides.advertisingId ?? generateUuid(),
    requestId: overrides.requestId ?? generateUuid(),
    traySessionId: overrides.traySessionId ?? generateUuid(),
    pigeonSessionId: overrides.pigeonSessionId ?? `UFS-${generateUuid()}-1`,
    androidDeviceId: overrides.androidDeviceId ?? generateAndroidDeviceId(),
  };
}

export function buildUserAgent(profile: DeviceProfile, locale = 'en_US'): string {
  return (
    `Instagram ${profile.appVersion} Android ` +
    `(${String(profile.androidVersion)}/${profile.androidRelease}; ` +
    `${profile.dpi}; ${profile.resolution}; ${profile.manufacturer}; ` +
    `${profile.model}; ${profile.device}; ${profile.cpu}; ${locale}; ${profile.versionCode})`
  );
}
