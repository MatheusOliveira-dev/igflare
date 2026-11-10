import type { PrivateClient } from '../../core/http/private-client';
import type { PrivateResponseJson } from '../../core/http/response';
import { extractContextData } from '../../core/bloks/parser';
import { generateTotp } from '../../core/crypto/totp';
import type { CaaTwoFactorRequiredError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { bloksApp, bloksAsyncAction } from './bloks';
import {
  CAA_API_DOMAIN,
  buildTwoFactorCodeEntryParams,
  buildTwoFactorEntrypointParams,
  buildTwoFactorSubmitParams,
} from './caa-params';
import { AP_2SV_CODE_ENTRY_ASYNC, AP_2SV_ENTRYPOINT, applyCaaResult } from './caa-result';

const AP_2SV_CODE_ENTRY = 'com.bloks.www.ap.two_step_verification.code_entry';

/**
 * Where the one-time code comes from: a literal code, a base32 TOTP secret the
 * SDK turns into the current authenticator code, or a function that asks the
 * caller (for example, prompting a person for an SMS or email code).
 */
export type TwoFactorSource =
  | { readonly code: string }
  | { readonly totpSecret: string }
  | { readonly provider: () => string | Promise<string> };

/** Resolves a {@link TwoFactorSource} to the code string to submit. */
export async function resolveTwoFactorCode(source: TwoFactorSource): Promise<string> {
  if ('code' in source) {
    return source.code;
  }
  if ('totpSecret' in source) {
    return generateTotp(source.totpSecret);
  }
  return source.provider();
}

/** Reads one step's context token, failing clearly when the response lacks it. */
function requireContext(result: PrivateResponseJson, appId: string, step: string): string {
  const context = extractContextData(result, appId);
  if (context === '') {
    throw new IgError(`The two-factor ${step} response did not include its context`);
  }
  return context;
}

/**
 * Completes a CAA login that stopped at the two-factor step by driving the Bloks
 * code-entry screens and submitting the code. On success the session carries the
 * user id and the authorization, exactly as after a login with no second factor.
 * Pass the error `caaLogin` threw and the code to submit, or a source for it. A
 * source is asked only after the code-entry screen has opened: when the code is
 * delivered out of band (an email or SMS), opening that screen is what makes the
 * server send it, so it cannot be known earlier.
 */
export async function resolveCaaTwoFactor(
  client: PrivateClient,
  error: CaaTwoFactorRequiredError,
  code: string | TwoFactorSource,
): Promise<PrivateResponseJson> {
  const { device } = client.session;
  const machineId = client.session.auth.mid ?? '';
  const raw = error.payload.raw;
  if (raw === undefined) {
    throw new IgError('The two-factor error carries no response to resume from');
  }

  const entryContext = requireContext(raw, AP_2SV_ENTRYPOINT, 'entrypoint');
  const entryResult = await bloksAsyncAction(
    client,
    AP_2SV_ENTRYPOINT,
    buildTwoFactorEntrypointParams(device, machineId, entryContext, Date.now()),
    { domain: CAA_API_DOMAIN },
  );

  const codeContext = requireContext(entryResult, AP_2SV_CODE_ENTRY, 'code entry');
  const codeResult = await bloksApp(
    client,
    AP_2SV_CODE_ENTRY,
    buildTwoFactorCodeEntryParams(device, error.aac, codeContext),
    { domain: CAA_API_DOMAIN },
  );

  const submitContext = requireContext(codeResult, AP_2SV_CODE_ENTRY_ASYNC, 'code submission');
  const submittedCode = await resolveTwoFactorCode(typeof code === 'string' ? { code } : code);
  const submitResult = await bloksAsyncAction(
    client,
    AP_2SV_CODE_ENTRY_ASYNC,
    buildTwoFactorSubmitParams(device, {
      aac: error.aac,
      code: submittedCode,
      machineId,
      contextData: submitContext,
      now: Date.now(),
    }),
    { domain: CAA_API_DOMAIN },
  );

  return applyCaaResult(client, submitResult, error.aac);
}
