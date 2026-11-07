import type { DeviceProfile, DeviceState } from './device';
import { buildUserAgent } from './device';

export interface BaseHeadersInput {
  readonly profile: DeviceProfile;
  readonly device: DeviceState;
  readonly locale?: string;
  readonly country?: string;
  readonly timezoneOffset?: number;
  readonly userId?: string;
  readonly mid?: string;
  readonly wwwClaim?: string;
  readonly authorization?: string;
}

/**
 * The stable `X-IG-*` headers derived from the device and profile. Live, time or
 * session-based headers (pigeon timestamp, zero-rating, region hints) are added
 * by the request layer once auth lands.
 */
export function buildBaseHeaders(input: BaseHeadersInput): Record<string, string> {
  const locale = input.locale ?? 'en_US';
  const country = input.country ?? 'US';
  const timezoneOffset = input.timezoneOffset ?? 0;
  const { profile, device } = input;

  const acceptLanguage = ['en-US'];
  const lang = locale.replace('_', '-');
  if (!acceptLanguage.includes(lang)) {
    acceptLanguage.unshift(lang);
  }

  const headers: Record<string, string> = {
    'X-IG-App-Locale': locale,
    'X-IG-Device-Locale': locale,
    'X-IG-Mapped-Locale': locale,
    'X-Pigeon-Session-Id': device.pigeonSessionId,
    'X-IG-App-Startup-Country': country.toUpperCase(),
    'X-Bloks-Version-Id': profile.bloksVersioningId,
    'X-IG-WWW-Claim': input.wwwClaim ?? '0',
    'X-Bloks-Is-Layout-RTL': 'false',
    'X-Bloks-Is-Panorama-Enabled': 'true',
    'X-IG-Device-ID': device.uuid,
    'X-IG-Family-Device-ID': device.phoneId,
    'X-IG-Android-ID': device.androidDeviceId,
    'X-IG-Timezone-Offset': String(timezoneOffset),
    'X-IG-Connection-Type': 'WIFI',
    'X-IG-Capabilities': profile.capabilities,
    'X-IG-App-ID': profile.appId,
    Priority: 'u=3',
    'User-Agent': buildUserAgent(profile, locale),
    'Accept-Language': acceptLanguage.join(', '),
    'Accept-Encoding': 'gzip, deflate',
    'X-FB-HTTP-Engine': 'Tigon/MNS/TCP',
    Connection: 'keep-alive',
    'IG-INTENDED-USER-ID': input.userId ?? '0',
  };

  if (input.mid !== undefined && input.mid !== '') {
    headers['X-MID'] = input.mid;
  }
  if (input.userId !== undefined && input.userId !== '') {
    headers['IG-U-DS-USER-ID'] = input.userId;
  }
  if (input.authorization !== undefined && input.authorization !== '') {
    headers['Authorization'] = input.authorization;
  }

  return headers;
}
