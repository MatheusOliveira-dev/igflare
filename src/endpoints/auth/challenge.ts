import type { PrivateClient } from '../../core/http/private-client';
import type { PrivateResponseJson } from '../../core/http/response';
import type { ChallengeRequiredError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { finalizeLogin } from './login';

/** Verification channels for the common challenge flow. */
export const CHALLENGE_SMS = 0;
/** The challenge method that sends the code by email. */
export const CHALLENGE_EMAIL = 1;

/** An open challenge: where to answer it and what the server sent. */
export interface Challenge {
  readonly apiPath: string;
  /** The raw step data, so unusual challenge types can be handled by the caller. */
  readonly data: PrivateResponseJson;
}

function readChallengeApiPath(error: ChallengeRequiredError): string {
  const challenge = error.payload.raw?.['challenge'];
  if (typeof challenge === 'object' && challenge !== null && 'api_path' in challenge) {
    const apiPath = challenge.api_path;
    if (typeof apiPath === 'string') {
      return apiPath;
    }
  }
  throw new IgError('The challenge response did not include an api_path');
}

function normalizeApiPath(apiPath: string): string {
  if (apiPath.startsWith('/api/v1/')) {
    return apiPath.slice('/api/v1'.length);
  }
  if (apiPath.startsWith('/api/')) {
    return apiPath.slice('/api'.length);
  }
  return apiPath;
}

/**
 * Opens the challenge referenced by a ChallengeRequiredError. Covers the common
 * select-method / submit-code flow. Bloks and contact-form variants are not
 * handled here. Their details are in the response `data`, for the caller to drive.
 */
export async function startChallenge(
  client: PrivateClient,
  error: ChallengeRequiredError,
): Promise<Challenge> {
  const apiPath = normalizeApiPath(readChallengeApiPath(error));
  const data = await client.request({ method: 'GET', endpoint: apiPath });
  return { apiPath, data };
}

/** Chooses a verification channel (CHALLENGE_SMS or CHALLENGE_EMAIL); sends the code. */
export async function selectChallengeMethod(
  client: PrivateClient,
  challenge: Challenge,
  choice: number,
): Promise<PrivateResponseJson> {
  return client.request({
    method: 'POST',
    endpoint: challenge.apiPath,
    payload: { choice: String(choice) },
    withDefaultData: false,
  });
}

/** Submits the verification code. On success the session is finalized and persisted. */
export async function submitChallengeCode(
  client: PrivateClient,
  challenge: Challenge,
  code: string,
): Promise<PrivateResponseJson> {
  const json = await client.request({
    method: 'POST',
    endpoint: challenge.apiPath,
    payload: { security_code: code },
    withDefaultData: false,
  });
  return finalizeLogin(client, json);
}
