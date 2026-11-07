import type { HttpResponse } from '../transport/http-transport';
import type { SessionData } from '../session/session';

/** Pulls refreshed auth material out of response headers into the session. */
export function applyResponseToSession(session: SessionData, response: HttpResponse): SessionData {
  const mid = response.headers['ig-set-x-mid'];
  const wwwClaim = response.headers['x-ig-set-www-claim'];
  const authorization = response.headers['ig-set-authorization'];

  if (mid === undefined && wwwClaim === undefined && authorization === undefined) {
    return session;
  }

  return {
    ...session,
    auth: {
      ...session.auth,
      ...(mid !== undefined ? { mid } : {}),
      ...(wwwClaim !== undefined ? { wwwClaim } : {}),
      ...(authorization !== undefined ? { authorization } : {}),
    },
  };
}
