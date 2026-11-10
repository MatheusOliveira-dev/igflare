import { describe, it, expect } from 'vitest';
import { setBiography } from './account';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';

function clientReturning(body: unknown): { client: PrivateClient; transport: FakeTransport } {
  const transport = new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  }));
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

function signedPayload(body: string | Uint8Array | undefined): Record<string, unknown> {
  const form = new URLSearchParams(typeof body === 'string' ? body : '');
  const signed = form.get('signed_body') ?? '';
  return JSON.parse(signed.slice(signed.indexOf('.') + 1)) as Record<string, unknown>;
}

describe('setBiography', () => {
  it('posts the raw text and returns the updated user', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      user: { pk: 1, username: 'me', biography: 'hello world' },
    });

    const user = await setBiography(client, 'hello world');

    expect(transport.requests[0]?.url).toContain('/api/v1/accounts/set_biography/');
    expect(signedPayload(transport.requests[0]?.body)['raw_text']).toBe('hello world');
    expect(user.biography).toBe('hello world');
  });

  it('throws when the response has no valid user', async () => {
    const { client } = clientReturning({ status: 'ok' });
    await expect(setBiography(client, 'x')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});
