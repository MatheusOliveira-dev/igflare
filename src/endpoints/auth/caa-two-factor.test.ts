import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveCaaTwoFactor, resolveTwoFactorCode } from './caa-two-factor';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { generateTotp } from '../../core/crypto/totp';
import { CaaTwoFactorRequiredError, InvalidVerificationCodeError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const ENTRYPOINT = 'com.bloks.www.ap.two_step_verification.entrypoint_async';
const CODE_ENTRY = 'com.bloks.www.ap.two_step_verification.code_entry';
const CODE_ENTRY_ASYNC = 'com.bloks.www.ap.two_step_verification.code_entry_async';

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

/** A Bloks response whose action carries the static params (with context_data) of an app. */
function withContext(appId: string, context: string): HttpResponse {
  return json({
    status: 'ok',
    layout: {
      bloks_payload: { action: `"${appId}" (f4i (dkc "context_data") (dkc "${context}"))` },
    },
  });
}

function loginSuccess(pk: number): HttpResponse {
  const bundle = JSON.stringify({
    login_response: JSON.stringify({ logged_in_user: { pk } }),
    headers: JSON.stringify({ 'IG-Set-Authorization': 'Bearer IGT:2:tok' }),
    cookies: '',
  });
  return json({
    status: 'ok',
    layout: { bloks_payload: { action: `(bk.action.caa.Login, ${JSON.stringify(bundle)})` } },
  });
}

function formField(request: HttpRequest | undefined, field: string): string {
  const body = typeof request?.body === 'string' ? request.body : '';
  return new URLSearchParams(body).get(field) ?? '';
}

function paramsOf(request: HttpRequest | undefined): {
  client_input_params: Record<string, unknown>;
  server_params: Record<string, unknown>;
} {
  return JSON.parse(formField(request, 'params')) as {
    client_input_params: Record<string, unknown>;
    server_params: Record<string, unknown>;
  };
}

/** The error a login throws when it stops at the two-factor step with `response`. */
function stoppedAt2fa(response: HttpResponse): CaaTwoFactorRequiredError {
  const raw = JSON.parse(response.body) as Record<string, unknown>;
  return new CaaTwoFactorRequiredError('Two-factor verification required', 200, { raw }, 'AAC1');
}

function scripted(submit: () => HttpResponse = () => loginSuccess(321)): {
  client: PrivateClient;
  transport: FakeTransport;
} {
  const transport = new FakeTransport((req) => {
    if (req.url.includes(`${CODE_ENTRY_ASYNC}/`)) {
      return submit();
    }
    if (req.url.includes(`/bloks/apps/${CODE_ENTRY}/`)) {
      return withContext(CODE_ENTRY_ASYNC, 'CTX_SUBMIT');
    }
    return withContext(CODE_ENTRY, 'CTX_CODE_ENTRY');
  });
  const client = new PrivateClient({
    transport,
    session: createSession({ auth: { mid: 'MID9' } }),
  });
  return { client, transport };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveCaaTwoFactor', () => {
  it('drives entrypoint, code entry and submit, then applies the session', async () => {
    const { client, transport } = scripted();
    const error = stoppedAt2fa(withContext(ENTRYPOINT, 'CTX_ENTRY'));

    const response = await resolveCaaTwoFactor(client, error, '123456');

    expect(response).toMatchObject({ logged_in_user: { pk: 321 } });
    expect(client.session.auth.userId).toBe('321');
    expect(client.session.auth.authorization).toBe('Bearer IGT:2:tok');

    const [entry, codeEntry, submit] = transport.requests;
    expect(entry?.url).toContain(
      `https://b.i.instagram.com/api/v1/bloks/async_action/${ENTRYPOINT}/`,
    );
    expect(paramsOf(entry).server_params['context_data']).toBe('CTX_ENTRY');

    expect(codeEntry?.url).toContain(`/api/v1/bloks/apps/${CODE_ENTRY}/`);
    expect(paramsOf(codeEntry).client_input_params['aac']).toBe('AAC1');
    expect(paramsOf(codeEntry).server_params['context_data']).toBe('CTX_CODE_ENTRY');

    expect(submit?.url).toContain(`/api/v1/bloks/async_action/${CODE_ENTRY_ASYNC}/`);
    expect(paramsOf(submit).client_input_params).toMatchObject({
      aac: 'AAC1',
      code: '123456',
      machine_id: 'MID9',
    });
    expect(paramsOf(submit).server_params['context_data']).toBe('CTX_SUBMIT');
  });

  it('fails clearly when the entrypoint context is missing from the login response', async () => {
    const { client } = scripted();
    const error = stoppedAt2fa(json({ status: 'ok' }));
    await expect(resolveCaaTwoFactor(client, error, '1')).rejects.toThrow(/entrypoint/);
  });

  it('fails clearly when a later step returns no context', async () => {
    const transport = new FakeTransport(() => json({ status: 'ok', layout: {} }));
    const client = new PrivateClient({ transport, session: createSession() });
    const error = stoppedAt2fa(withContext(ENTRYPOINT, 'CTX_ENTRY'));
    await expect(resolveCaaTwoFactor(client, error, '1')).rejects.toThrow(/code entry/);
  });

  it('rejects an error that carries no response to resume from', async () => {
    const { client } = scripted();
    const error = new CaaTwoFactorRequiredError('x', 200, {}, 'AAC1');
    await expect(resolveCaaTwoFactor(client, error, '1')).rejects.toBeInstanceOf(IgError);
  });

  it('types a refused code: the code-entry screen comes back instead of a session', async () => {
    const { client } = scripted(() => withContext(CODE_ENTRY_ASYNC, 'CTX_AGAIN'));
    const error = stoppedAt2fa(withContext(ENTRYPOINT, 'CTX_ENTRY'));
    await expect(resolveCaaTwoFactor(client, error, '000000')).rejects.toBeInstanceOf(
      InvalidVerificationCodeError,
    );
  });

  it('surfaces a typed error when the submit does not return a session', async () => {
    const { client } = scripted(() => json({ status: 'ok', layout: { bloks_payload: {} } }));
    const error = stoppedAt2fa(withContext(ENTRYPOINT, 'CTX_ENTRY'));
    await expect(resolveCaaTwoFactor(client, error, '000000')).rejects.toThrow(
      /did not return a session/,
    );
  });
});

describe('resolveCaaTwoFactor code source timing', () => {
  it('asks a source only after the code-entry screen opened, so an out-of-band code exists', async () => {
    const { client, transport } = scripted();
    const error = stoppedAt2fa(withContext(ENTRYPOINT, 'CTX_ENTRY'));
    let requestsWhenAsked = -1;

    await resolveCaaTwoFactor(client, error, {
      provider: () => {
        requestsWhenAsked = transport.requests.length;
        return '135790';
      },
    });

    // entrypoint + code entry have already been sent; the submit has not.
    expect(requestsWhenAsked).toBe(2);
    expect(paramsOf(transport.requests[2]).client_input_params['code']).toBe('135790');
  });

  it('does not ask the source when an earlier step fails', async () => {
    const transport = new FakeTransport(() => json({ status: 'ok', layout: {} }));
    const client = new PrivateClient({ transport, session: createSession() });
    const error = stoppedAt2fa(withContext(ENTRYPOINT, 'CTX_ENTRY'));
    let asked = false;

    await expect(
      resolveCaaTwoFactor(client, error, {
        provider: () => {
          asked = true;
          return '1';
        },
      }),
    ).rejects.toThrow(/code entry/);
    expect(asked).toBe(false);
  });
});

describe('resolveTwoFactorCode', () => {
  it('returns a literal code as given', async () => {
    expect(await resolveTwoFactorCode({ code: '654321' })).toBe('654321');
  });

  it('generates the current authenticator code from a TOTP secret', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(59_000);
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(await resolveTwoFactorCode({ totpSecret: secret })).toBe(
      generateTotp(secret, { now: 59 }),
    );
    expect(await resolveTwoFactorCode({ totpSecret: secret })).toBe('287082');
  });

  it('asks a provider function, sync or async', async () => {
    expect(await resolveTwoFactorCode({ provider: () => '111111' })).toBe('111111');
    expect(await resolveTwoFactorCode({ provider: () => Promise.resolve('222222') })).toBe(
      '222222',
    );
  });
});
