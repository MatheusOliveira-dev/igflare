import type { PrivateClient } from '../../core/http/private-client';
import type { PrivateResponseJson } from '../../core/http/response';
import { mapError } from '../../core/http/response';
import { extractLoginResponse, allText } from '../../core/bloks/parser';
import {
  IgApiError,
  CaaTwoFactorRequiredError,
  InvalidVerificationCodeError,
} from '../../errors/api-errors';
import { isRecord } from '../../core/guards';

/** The Bloks action the login routes to when the account needs a two-factor code. */
export const AP_2SV_ENTRYPOINT = 'com.bloks.www.ap.two_step_verification.entrypoint_async';

/** The code-submission screen; a response that shows it again means the code was refused. */
export const AP_2SV_CODE_ENTRY_ASYNC = 'com.bloks.www.ap.two_step_verification.code_entry_async';

function extractUserId(loginResponse: Record<string, unknown>): string | undefined {
  const user = loginResponse['logged_in_user'];
  if (isRecord(user) && (typeof user['pk'] === 'number' || typeof user['pk'] === 'string')) {
    return String(user['pk']);
  }
  return undefined;
}

/** Whether a decoded login_response is a successful login rather than an error payload. */
function isSuccessLogin(loginResponse: Record<string, unknown>): boolean {
  return isRecord(loginResponse['logged_in_user']);
}

/**
 * Bloks error states that carry no login_response bundle are surfaced as action
 * markers. Each entry maps a marker string to the typed error it raises. Only the
 * markers with a captured response are listed. Others await a real sample (the
 * flow still fails with a typed IgApiError until then).
 */
const CAA_ERROR_MARKERS: readonly {
  readonly marker: string;
  readonly make: (raw: PrivateResponseJson, aac: string) => IgApiError;
}[] = [
  {
    marker: AP_2SV_ENTRYPOINT,
    make: (raw, aac) =>
      new CaaTwoFactorRequiredError('Two-factor verification required', 200, { raw }, aac),
  },
  {
    // Seen live: a refused code re-renders the same code-entry screen instead of
    // returning a session. It can be a wrong or an expired code, so the message
    // says only that it was not accepted.
    marker: AP_2SV_CODE_ENTRY_ASYNC,
    make: (raw) =>
      new InvalidVerificationCodeError('The verification code was not accepted', 200, { raw }),
  },
];

/**
 * Applies a CAA login or code-submission response: the session on success, a typed
 * error otherwise. `aac` is the account access context of this login attempt. A
 * two-factor stop carries it so the code submission can echo it back.
 */
export async function applyCaaResult(
  client: PrivateClient,
  result: PrivateResponseJson,
  aac: string,
): Promise<PrivateResponseJson> {
  const bundle = extractLoginResponse(result);
  if (bundle === null) {
    const text = allText(result);
    for (const { marker, make } of CAA_ERROR_MARKERS) {
      if (text.includes(marker)) {
        throw make(result, aac);
      }
    }
    throw new IgApiError('CAA login did not return a session', 200, { raw: result });
  }

  if (!isSuccessLogin(bundle.loginResponse)) {
    // The embedded login_response is an error payload (bad password, challenge,
    // rate limit, ...). It shares the REST error shape, so reuse that taxonomy.
    throw mapError(200, bundle.loginResponse);
  }

  const authorization =
    bundle.headers['IG-Set-Authorization'] ?? bundle.headers['ig-set-authorization'];
  const userId = extractUserId(bundle.loginResponse);
  client.patchAuth({
    ...(authorization !== undefined && authorization !== '' ? { authorization } : {}),
    ...(userId !== undefined ? { userId, lastLogin: Date.now() } : {}),
    ...(Object.keys(bundle.cookies).length > 0 ? { cookies: bundle.cookies } : {}),
  });
  await client.persist();
  return bundle.loginResponse;
}
