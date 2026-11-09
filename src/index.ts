export { IgError, IgResponseError } from './errors/ig-error';
export {
  IgApiError,
  LoginRequiredError,
  TwoFactorRequiredError,
  ChallengeRequiredError,
  AccountSuspendedError,
  FeedbackRequiredError,
  SentryBlockError,
  RateLimitError,
  BadPasswordError,
  PleaseWaitError,
  ClientForbiddenError,
  ClientJsonError,
} from './errors/api-errors';
export type { ApiErrorPayload } from './errors/api-errors';
export { parsePrivateResponse } from './core/http/response';
export type { PrivateResponseJson } from './core/http/response';
export { quotePlus, buildSignedBody, jazoest, createSigner } from './core/signing/signer';
export type { Signer } from './core/signing/signer';
export { encryptPassword } from './core/crypto/password';
export type { PasswordPublicKey, EncryptPasswordOptions } from './core/crypto/password';
export {
  base64url,
  generateUsdidIdentity,
  usdidPublicKeyDer,
  signUsdid,
  buildUsdidHeader,
  buildUsdidRegistrationToken,
  USDID_TOKEN_TTL,
} from './core/crypto/usdid';
export type {
  UsdidIdentity,
  GenerateUsdidOptions,
  UsdidHeaderOptions,
  RegistrationTokenOptions,
} from './core/crypto/usdid';
export { buildAttestationParams, ATTESTATION_KEYSTORE_ERROR } from './core/crypto/attestation';
export {
  DEFAULT_DEVICE_PROFILE,
  generateUuid,
  generateAndroidDeviceId,
  createDeviceState,
  buildUserAgent,
} from './core/transport/device';
export type { DeviceProfile, DeviceState } from './core/transport/device';
export { buildBaseHeaders } from './core/transport/headers';
export type { BaseHeadersInput } from './core/transport/headers';
export type {
  HttpTransport,
  HttpRequest,
  HttpResponse,
  HttpMethod,
} from './core/transport/http-transport';
export { HttpsTransport } from './core/transport/adapters/https';
export { FetchTransport } from './core/transport/adapters/fetch';
export { FakeTransport } from './core/transport/adapters/fake';
export type { FakeHandler } from './core/transport/adapters/fake';
export { createSession, parseSessionData, DEFAULT_LOCATION } from './core/session/session';
export type {
  SessionData,
  SessionStore,
  AuthState,
  LocationState,
  CreateSessionOptions,
} from './core/session/session';
export { MemorySessionStore } from './core/session/adapters/memory';
export { FileSessionStore } from './core/session/adapters/file';
export { buildPrivateRequest, API_DOMAIN } from './core/http/request-builder';
export type { PrivateRequestInput } from './core/http/request-builder';
export { applyResponseToSession } from './core/http/session-update';
export { PrivateClient } from './core/http/private-client';
export type { PrivateClientOptions, PrivateRequestOptions } from './core/http/private-client';
export { login, fetchPasswordPublicKey } from './endpoints/auth/login';
export type { LoginCredentials } from './endpoints/auth/login';
export { twoFactorLogin } from './endpoints/auth/two-factor';
export type { TwoFactorOptions } from './endpoints/auth/two-factor';
export {
  startChallenge,
  selectChallengeMethod,
  submitChallengeCode,
  CHALLENGE_SMS,
  CHALLENGE_EMAIL,
} from './endpoints/auth/challenge';
export type { Challenge } from './endpoints/auth/challenge';
export { endpoints } from './generated/endpoints';
export type { EndpointName, EndpointDefinition } from './generated/endpoints';
