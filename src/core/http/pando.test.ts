import { describe, it, expect } from 'vitest';
import { pandoRequest } from './pando';
import { PrivateClient } from './private-client';
import { FakeTransport } from '../transport/adapters/fake';
import { createSession } from '../session/session';

function clientReturning(body: unknown): { client: PrivateClient; transport: FakeTransport } {
  const transport = new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  }));
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

const QUERY = {
  friendlyName: 'ExampleQuery',
  docId: '1234567890',
  rootField: 'example_root',
  variables: { a: 1, nested: { b: [true] } },
};

describe('pandoRequest', () => {
  it('posts a persisted query to graphql_www as a form', async () => {
    const { client, transport } = clientReturning({ data: { ok: true } });

    const json = await pandoRequest(client, QUERY);

    expect(json).toEqual({ data: { ok: true } });
    const request = transport.requests[0];
    expect(request?.url).toBe('https://i.instagram.com/graphql_www');
    expect(request?.method).toBe('POST');
    const form = new URLSearchParams(typeof request?.body === 'string' ? request.body : '');
    expect(form.get('client_doc_id')).toBe('1234567890');
    expect(form.get('fb_api_req_friendly_name')).toBe('ExampleQuery');
    expect(JSON.parse(form.get('variables') ?? '')).toEqual(QUERY.variables);
    expect(request?.headers['X-FB-Friendly-Name']).toBe('ExampleQuery');
    expect(request?.headers['X-Client-Doc-Id']).toBe('1234567890');
    expect(request?.headers['X-Root-Field-Name']).toBe('example_root');
    expect(request?.headers['X-Graphql-Client-Library']).toBe('pando');
  });

  it('uses another host when asked to', async () => {
    const { client, transport } = clientReturning({ data: {} });
    await pandoRequest(client, { ...QUERY, domain: 'b.i.instagram.com' });
    expect(transport.requests[0]?.url).toBe('https://b.i.instagram.com/graphql_www');
  });

  it('returns the errors of the body instead of throwing on them', async () => {
    const { client } = clientReturning({ data: null, errors: [{ message: 'nope' }] });
    expect(await pandoRequest(client, QUERY)).toEqual({
      data: null,
      errors: [{ message: 'nope' }],
    });
  });
});
