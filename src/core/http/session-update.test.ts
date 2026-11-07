import { describe, it, expect } from 'vitest';
import { applyResponseToSession } from './session-update';
import { createSession } from '../session/session';
import type { HttpResponse } from '../transport/http-transport';

const base = createSession();

function response(headers: Record<string, string>): HttpResponse {
  return { status: 200, headers, body: '{}' };
}

describe('applyResponseToSession', () => {
  it('returns the same session when no auth headers are present', () => {
    expect(applyResponseToSession(base, response({}))).toBe(base);
  });

  it('captures mid, www-claim and authorization without mutating the original', () => {
    const updated = applyResponseToSession(
      base,
      response({
        'ig-set-x-mid': 'MID1',
        'x-ig-set-www-claim': 'hmac.claim',
        'ig-set-authorization': 'Bearer IGT:2:abc',
      }),
    );
    expect(updated.auth.mid).toBe('MID1');
    expect(updated.auth.wwwClaim).toBe('hmac.claim');
    expect(updated.auth.authorization).toBe('Bearer IGT:2:abc');
    expect(base.auth.mid).toBeUndefined();
  });
});
