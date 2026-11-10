import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { caaLogin } from './caa-login';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { generateUsdidIdentity } from '../../core/crypto/usdid';
import {
  TwoFactorRequiredError,
  CaaTwoFactorRequiredError,
  BadPasswordError,
  ChallengeRequiredError,
  IgApiError,
} from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pubKeyB64 = Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64');

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function loginBundleAction(pk: number, authorization: string, sessionid: string): string {
  const value = JSON.stringify({
    login_response: JSON.stringify({ logged_in_user: { pk } }),
    headers: JSON.stringify({ 'IG-Set-Authorization': authorization }),
    cookies: `Set-Cookie: sessionid=${sessionid}; Path=/`,
  });
  return `(bk.action.caa.Login, ${JSON.stringify(value)})`;
}

/** Builds a send-login action whose embedded login_response is an error payload. */
function errorBundleAction(loginResponse: Record<string, unknown>): string {
  const value = JSON.stringify({
    login_response: JSON.stringify(loginResponse),
    headers: JSON.stringify({}),
    cookies: '',
  });
  return `(bk.action.caa.Login, ${JSON.stringify(value)})`;
}

/** Routes each CAA step to a canned response; `onSend` controls send_login_request. */
function caaTransport(onSend: (req: HttpRequest) => HttpResponse): FakeTransport {
  return new FakeTransport((req) => {
    if (req.url.includes('launcher/sync')) {
      return {
        status: 200,
        headers: {
          'ig-set-password-encryption-key-id': '173',
          'ig-set-password-encryption-pub-key': pubKeyB64,
          'ig-set-x-mid': 'MID123',
        },
        body: '{"status":"ok"}',
      };
    }
    if (req.url.includes('graphql_www')) {
      return json({ data: { xfb_usdid_registration: { success: true } } });
    }
    if (req.url.includes('process_client_data_and_redirect')) {
      return json({
        status: 'ok',
        layout: {
          bloks_payload: {
            data: [{ data: { key: 'CAA_ACCOUNT_ACCESS_CONTEXT:aac', initial: 'AAC1' } }],
          },
        },
      });
    }
    if (req.url.includes('attestation/create_android_keystore')) {
      return json({ status: 'ok', challenge_nonce: 'NONCE1', key_nonce: 'KEY1' });
    }
    if (req.url.includes('oauth.token.fetch')) {
      return json({ status: 'ok' });
    }
    return onSend(req);
  });
}

function client(fake: FakeTransport): PrivateClient {
  return new PrivateClient({ transport: fake, session: createSession() });
}

describe('caaLogin', () => {
  it('runs the full flow and applies the session on success', async () => {
    const fake = caaTransport(() =>
      json({
        status: 'ok',
        layout: { bloks_payload: { action: loginBundleAction(999, 'Bearer IGT:2:tok', 'SESS9') } },
      }),
    );
    const privateClient = client(fake);

    const response = await caaLogin(privateClient, { username: 'u', password: 'p' });

    expect(response).toMatchObject({ logged_in_user: { pk: 999 } });
    expect(privateClient.session.auth.authorization).toBe('Bearer IGT:2:tok');
    expect(privateClient.session.auth.userId).toBe('999');
    expect(privateClient.session.auth.cookies).toEqual({ sessionid: 'SESS9' });
    expect(privateClient.session.usdid).toBeDefined();
    expect(privateClient.session.usdidRegistered).toBe(true);
  });

  it('sends the CAA requests to the CAA domain with the signed USDID header', async () => {
    const fake = caaTransport(() =>
      json({
        status: 'ok',
        layout: { bloks_payload: { action: loginBundleAction(1, 'Bearer IGT:2:x', 'S') } },
      }),
    );
    await caaLogin(client(fake), { username: 'u', password: 'p' });

    const process = fake.requests.find((r) => r.url.includes('process_client_data_and_redirect'));
    expect(process?.url).toContain('https://b.i.instagram.com/');
    expect(process?.headers['X-Meta-Usdid']).toMatch(/^[0-9a-f-]{36}\.\d+\./);

    const send = fake.requests.find((r) => r.url.includes('send_login_request'));
    expect(send?.headers['X-IG-Attest-Params']).toContain('"challenge_nonce":"NONCE1"');
    const body = new URLSearchParams(typeof send?.body === 'string' ? send.body : '');
    const params = JSON.parse(body.get('params') ?? '{}') as {
      client_input_params: { machine_id: string; contact_point: string };
    };
    expect(params.client_input_params.machine_id).toBe('MID123');
    expect(params.client_input_params.contact_point).toBe('u');
  });

  it('fails when USDID registration is rejected', async () => {
    const fake = new FakeTransport((req) => {
      if (req.url.includes('launcher/sync')) {
        return {
          status: 200,
          headers: {
            'ig-set-password-encryption-key-id': '173',
            'ig-set-password-encryption-pub-key': pubKeyB64,
          },
          body: '{"status":"ok"}',
        };
      }
      return json({ data: { xfb_usdid_registration: { success: false } } });
    });
    await expect(caaLogin(client(fake), { username: 'u', password: 'p' })).rejects.toBeInstanceOf(
      IgError,
    );
  });

  it('fails when the preflight returns no account access context', async () => {
    const direct = new FakeTransport((req) => {
      if (req.url.includes('launcher/sync')) {
        return {
          status: 200,
          headers: {
            'ig-set-password-encryption-key-id': '173',
            'ig-set-password-encryption-pub-key': pubKeyB64,
          },
          body: '{"status":"ok"}',
        };
      }
      if (req.url.includes('graphql_www')) {
        return json({ data: { xfb_usdid_registration: { success: true } } });
      }
      if (req.url.includes('process_client_data_and_redirect')) {
        return json({ status: 'ok', layout: { bloks_payload: { data: [] } } });
      }
      return json({ status: 'ok' });
    });
    await expect(caaLogin(client(direct), { username: 'u', password: 'p' })).rejects.toThrow(
      /account access context/,
    );
  });

  it('skips USDID registration when already registered', async () => {
    const fake = caaTransport(() =>
      json({
        status: 'ok',
        layout: { bloks_payload: { action: loginBundleAction(5, 'Bearer IGT:2:y', 'S5') } },
      }),
    );
    const privateClient = new PrivateClient({ transport: fake, session: createSession() });
    privateClient.patchSession({ usdid: generateUsdidIdentity(), usdidRegistered: true });

    await caaLogin(privateClient, { username: 'u', password: 'p' });
    expect(fake.requests.some((r) => r.url.includes('graphql_www'))).toBe(false);
  });

  it('raises a two-factor error when CAA routes to the 2SV entrypoint', async () => {
    const fake = caaTransport(() =>
      json({
        status: 'ok',
        layout: {
          bloks_payload: {
            action: '(bk com.bloks.www.ap.two_step_verification.entrypoint_async)',
          },
        },
      }),
    );
    await expect(caaLogin(client(fake), { username: 'u', password: 'p' })).rejects.toBeInstanceOf(
      TwoFactorRequiredError,
    );
  });

  it('maps an embedded bad_password login_response to a typed error', async () => {
    const fake = caaTransport(() =>
      json({
        status: 'ok',
        layout: {
          bloks_payload: {
            action: errorBundleAction({
              status: 'fail',
              error_type: 'bad_password',
              message: 'The password you entered is incorrect.',
            }),
          },
        },
      }),
    );
    await expect(caaLogin(client(fake), { username: 'u', password: 'p' })).rejects.toBeInstanceOf(
      BadPasswordError,
    );
  });

  it('maps an embedded challenge_required login_response to a typed error', async () => {
    const fake = caaTransport(() =>
      json({
        status: 'ok',
        layout: {
          bloks_payload: {
            action: errorBundleAction({
              status: 'fail',
              message: 'challenge_required',
              challenge: { url: 'https://i.instagram.com/challenge/x/' },
            }),
          },
        },
      }),
    );
    await expect(caaLogin(client(fake), { username: 'u', password: 'p' })).rejects.toBeInstanceOf(
      ChallengeRequiredError,
    );
  });

  it('raises a typed IgApiError when the result has neither a session nor a known marker', async () => {
    const fake = caaTransport(() => json({ status: 'ok', layout: { bloks_payload: {} } }));
    await expect(caaLogin(client(fake), { username: 'u', password: 'p' })).rejects.toBeInstanceOf(
      IgApiError,
    );
  });
});

describe('caaLogin two-factor', () => {
  const ENTRYPOINT = 'com.bloks.www.ap.two_step_verification.entrypoint_async';
  const CODE_ENTRY = 'com.bloks.www.ap.two_step_verification.code_entry';
  const CODE_ENTRY_ASYNC = 'com.bloks.www.ap.two_step_verification.code_entry_async';

  function withContext(appId: string, context: string): HttpResponse {
    return json({
      status: 'ok',
      layout: {
        bloks_payload: { action: `"${appId}" (f4i (dkc "context_data") (dkc "${context}"))` },
      },
    });
  }

  /** A login that stops at the two-factor step, then walks the code-entry screens. */
  function twoFactorTransport(): FakeTransport {
    return caaTransport((req) => {
      if (req.url.includes('code_entry_async/')) {
        return json({
          status: 'ok',
          layout: { bloks_payload: { action: loginBundleAction(77, 'Bearer IGT:2:z', 'SS') } },
        });
      }
      if (req.url.includes('/bloks/apps/')) {
        return withContext(CODE_ENTRY_ASYNC, 'CTX_SUBMIT');
      }
      if (req.url.includes('entrypoint_async/')) {
        return withContext(CODE_ENTRY, 'CTX_CODE_ENTRY');
      }
      return withContext(ENTRYPOINT, 'CTX_ENTRY'); // send_login_request stops at 2FA
    });
  }

  function submittedCode(fake: FakeTransport): string {
    const submit = fake.requests.find((r) => r.url.includes('code_entry_async/'));
    const body = new URLSearchParams(typeof submit?.body === 'string' ? submit.body : '');
    const params = JSON.parse(body.get('params') ?? '{}') as {
      client_input_params: { code: string; aac: string };
    };
    expect(params.client_input_params.aac).toBe('AAC1');
    return params.client_input_params.code;
  }

  it('resolves the second factor itself from a literal code', async () => {
    const fake = twoFactorTransport();
    const privateClient = client(fake);

    const response = await caaLogin(
      privateClient,
      { username: 'u', password: 'p' },
      { twoFactor: { code: '123456' } },
    );

    expect(response).toMatchObject({ logged_in_user: { pk: 77 } });
    expect(privateClient.session.auth.userId).toBe('77');
    expect(submittedCode(fake)).toBe('123456');
  });

  it('generates the code from a TOTP secret', async () => {
    const fake = twoFactorTransport();

    await caaLogin(
      client(fake),
      { username: 'u', password: 'p' },
      { twoFactor: { totpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' } },
    );

    expect(submittedCode(fake)).toMatch(/^\d{6}$/);
  });

  it('throws an error carrying the aac when no code source is given', async () => {
    const error = await caaLogin(client(twoFactorTransport()), {
      username: 'u',
      password: 'p',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CaaTwoFactorRequiredError);
    expect(error).toBeInstanceOf(TwoFactorRequiredError);
    expect((error as CaaTwoFactorRequiredError).aac).toBe('AAC1');
  });
});
