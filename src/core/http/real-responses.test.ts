import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parsePrivateResponse } from './response';
import { userSchema } from '../../schemas/user';
import { mediaSchema } from '../../schemas/media';
import { LoginRequiredError } from '../../errors/api-errors';

// Real responses captured from Instagram and sanitized (the signed query strings of URLs
// and every token, session or contact field removed). They are kept as the server sent
// them, so 64-bit ids are plain JSON numbers here, as on the wire. The other tests build
// their responses by hand. These are the check that the parsers still agree with reality.
const FIXTURES = new URL('./__fixtures__/', import.meta.url);

function fixture(name: string): string {
  return readFileSync(new URL(name, FIXTURES), 'utf8');
}

function ok(body: string): { status: number; headers: Record<string, string>; body: string } {
  return { status: 200, headers: {}, body };
}

describe('real session-expired response', () => {
  it('maps to LoginRequiredError with the server status', () => {
    const response = { status: 403, headers: {}, body: fixture('login-required.json') };

    let caught: unknown;
    try {
      parsePrivateResponse(response);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LoginRequiredError);
    expect((caught as LoginRequiredError).statusCode).toBe(403);
    expect((caught as LoginRequiredError).payload.message).toBe('login_required');
  });
});

describe('real public profile', () => {
  it('parses through the user schema', () => {
    const json = parsePrivateResponse(ok(fixture('user-info-public.json')));

    const user = userSchema.parse(json['user']);

    expect(user.username).toBe('instagram');
    expect(user.pk).toBe('25025320');
    expect(user.is_verified).toBe(true);
    expect(typeof user.follower_count).toBe('number');
  });
});

describe('real post', () => {
  const body = fixture('media-info-public.json');

  it('arrives with its 64-bit pk as a bare JSON number, which a float would round', () => {
    // Guards the fixture itself: if it were re-saved through JSON.stringify the
    // lossless test below would pass for the wrong reason.
    expect(body).toContain('"pk":4027451352870611812');
    expect(Number('4027451352870611812').toString()).not.toBe('4027451352870611812');
  });

  it('parses through the media schema and keeps the pk exact', () => {
    const json = parsePrivateResponse(ok(body));
    const items = json['items'];
    expect(Array.isArray(items)).toBe(true);

    const media = mediaSchema.parse((items as unknown[])[0]);

    expect(media.pk).toBe('4027451352870611812');
    expect(media.id).toBe('4027451352870611812_25025320');
    expect(media.id?.startsWith(`${String(media.pk)}_`)).toBe(true);
    expect(media.user?.username).toBe('instagram');
    expect(typeof media.media_type).toBe('number');
  });
});

interface Entry {
  readonly key: string;
  readonly value: string;
}

/** Every string value in a parsed JSON document, with the key it sits under. */
function stringEntries(value: unknown, key = ''): Entry[] {
  if (typeof value === 'string') {
    return [{ key, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((child) => stringEntries(child, key));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([childKey, child]) => stringEntries(child, childKey));
  }
  return [];
}

const SENSITIVE_KEY = ['token', 'nonce', 'cookie', 'csrf', 'authorization', 'session'];

describe('fixture hygiene', () => {
  // Read structurally rather than with a pattern over the text, so a string with an
  // escaped quote or a long caption cannot hide or fake a match.
  it.each(['user-info-public.json', 'media-info-public.json', 'login-required.json'])(
    '%s holds no signed URL query, email address or token value',
    (name) => {
      const entries = stringEntries(JSON.parse(fixture(name)) as unknown);

      const urlsWithQuery = entries.filter(
        (entry) => /^https?:/.test(entry.value) && entry.value.includes('?'),
      );
      const emails = entries.filter(
        (entry) =>
          !/\s/.test(entry.value) && entry.value.includes('@') && entry.value.includes('.'),
      );
      const tokens = entries.filter(
        (entry) =>
          SENSITIVE_KEY.some((word) => entry.key.toLowerCase().includes(word)) &&
          entry.value !== '' &&
          entry.value !== 'REDACTED',
      );

      expect(urlsWithQuery).toEqual([]);
      expect(emails).toEqual([]);
      expect(tokens).toEqual([]);
    },
  );
});
