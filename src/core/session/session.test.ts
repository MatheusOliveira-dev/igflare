import { describe, it, expect } from 'vitest';
import { createSession, parseSessionData, DEFAULT_LOCATION } from './session';

describe('createSession', () => {
  it('uses the default location and empty auth', () => {
    const session = createSession();
    expect(session.location).toEqual(DEFAULT_LOCATION);
    expect(session.auth).toEqual({});
    expect(session.device.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.profile.appId).toBe('567067343352427');
  });

  it('applies overrides and keeps defaults for the rest', () => {
    const session = createSession({
      location: { country: 'BR', locale: 'pt_BR' },
      auth: { userId: '7' },
    });
    expect(session.location.country).toBe('BR');
    expect(session.location.locale).toBe('pt_BR');
    expect(session.location.timezoneOffset).toBe(0);
    expect(session.auth.userId).toBe('7');
  });
});

describe('parseSessionData', () => {
  it('accepts a freshly created session, so the schema matches the type', () => {
    expect(() => parseSessionData(createSession())).not.toThrow();
  });

  it('rejects malformed data', () => {
    expect(() => parseSessionData({ device: {}, profile: {}, auth: {}, location: {} })).toThrow();
  });
});
