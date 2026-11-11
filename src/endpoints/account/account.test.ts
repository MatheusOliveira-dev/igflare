import { describe, it, expect } from 'vitest';
import { setBiography, setName } from './account';
import { IgApiError, ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';

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

describe('setName', () => {
  const CURRENT = {
    status: 'ok',
    user: {
      pk: 1,
      username: 'me',
      biography: 'bio',
      email: 'me@example.invalid',
      phone_number: '',
      external_url: '',
      full_name: 'Old Name',
    },
  };

  function scripted(editResponse: unknown): { client: PrivateClient; transport: FakeTransport } {
    const transport = new FakeTransport((req) => ({
      status: 200,
      headers: {},
      body: JSON.stringify(req.url.includes('/edit_profile/') ? editResponse : CURRENT),
    }));
    return { client: new PrivateClient({ transport, session: createSession() }), transport };
  }

  it('reads the current profile, then sends the new name with the other fields unchanged', async () => {
    const { client, transport } = scripted({
      status: 'ok',
      user: { pk: 1, username: 'me', full_name: 'New Name' },
    });

    const user = await setName(client, '  New Name ');

    expect(transport.requests[0]?.url).toContain('/api/v1/accounts/current_user/');
    expect(transport.requests[1]?.url).toContain('/api/v1/accounts/edit_profile/');
    expect(signedPayload(transport.requests[1]?.body)).toMatchObject({
      first_name: 'New Name',
      username: 'me',
      biography: 'bio',
      email: 'me@example.invalid',
      phone_number: '',
      external_url: '',
    });
    expect(user.full_name).toBe('New Name');
  });

  it('refuses an empty name without calling the server', async () => {
    const { client, transport } = scripted({ status: 'ok' });
    await expect(setName(client, '   ')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when the response has no valid user', async () => {
    const { client } = scripted({ status: 'ok' });
    await expect(setName(client, 'X')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('surfaces the server refusal as a typed error', async () => {
    const transport = new FakeTransport((req) =>
      req.url.includes('/edit_profile/')
        ? {
            status: 400,
            headers: {},
            body: JSON.stringify({ status: 'fail', message: 'name change limit' }),
          }
        : { status: 200, headers: {}, body: JSON.stringify(CURRENT) },
    );
    const client = new PrivateClient({ transport, session: createSession() });
    await expect(setName(client, 'X')).rejects.toBeInstanceOf(IgApiError);
  });
});
