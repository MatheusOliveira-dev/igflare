import { z } from 'zod';
import { createDeviceState, DEFAULT_DEVICE_PROFILE } from '../transport/device';
import type { DeviceProfile, DeviceState } from '../transport/device';

/** Auth material gained after login. Everything here is optional before login. */
export interface AuthState {
  readonly userId?: string;
  readonly authorization?: string;
  readonly mid?: string;
  readonly wwwClaim?: string;
  readonly rur?: string;
  readonly cookies?: Record<string, string>;
  readonly lastLogin?: number;
}

/** Sent on every request and kept stable per account. */
export interface LocationState {
  readonly locale: string;
  readonly country: string;
  readonly timezoneOffset: number;
}

/** Everything needed to resume one logical account without logging in again. */
export interface SessionData {
  readonly device: DeviceState;
  readonly profile: DeviceProfile;
  readonly auth: AuthState;
  readonly location: LocationState;
}

export const DEFAULT_LOCATION: LocationState = {
  locale: 'en_US',
  country: 'US',
  timezoneOffset: 0,
};

/** Loads and persists a session. One of the three swappable seams. */
export interface SessionStore {
  load(): Promise<SessionData | null>;
  save(data: SessionData): Promise<void>;
}

export interface CreateSessionOptions {
  readonly device?: Partial<DeviceState>;
  readonly profile?: DeviceProfile;
  readonly auth?: AuthState;
  readonly location?: Partial<LocationState>;
}

export function createSession(options: CreateSessionOptions = {}): SessionData {
  return {
    device: createDeviceState(options.device ?? {}),
    profile: options.profile ?? DEFAULT_DEVICE_PROFILE,
    auth: options.auth ?? {},
    location: { ...DEFAULT_LOCATION, ...options.location },
  };
}

const deviceStateSchema = z.object({
  uuid: z.string(),
  phoneId: z.string(),
  clientSessionId: z.string(),
  advertisingId: z.string(),
  requestId: z.string(),
  traySessionId: z.string(),
  pigeonSessionId: z.string(),
  androidDeviceId: z.string(),
});

const deviceProfileSchema = z.object({
  appVersion: z.string(),
  versionCode: z.string(),
  bloksVersioningId: z.string(),
  androidVersion: z.number(),
  androidRelease: z.string(),
  dpi: z.string(),
  resolution: z.string(),
  manufacturer: z.string(),
  model: z.string(),
  device: z.string(),
  cpu: z.string(),
  appId: z.string(),
  capabilities: z.string(),
});

const authStateSchema = z.object({
  userId: z.string().optional(),
  authorization: z.string().optional(),
  mid: z.string().optional(),
  wwwClaim: z.string().optional(),
  rur: z.string().optional(),
  cookies: z.record(z.string(), z.string()).optional(),
  lastLogin: z.number().optional(),
});

const locationStateSchema = z.object({
  locale: z.string(),
  country: z.string(),
  timezoneOffset: z.number(),
});

const sessionDataSchema = z.object({
  device: deviceStateSchema,
  profile: deviceProfileSchema,
  auth: authStateSchema,
  location: locationStateSchema,
});

/** Parses untrusted JSON (a stored file) into a SessionData, or throws. */
export function parseSessionData(value: unknown): SessionData {
  return sessionDataSchema.parse(value) as SessionData;
}
