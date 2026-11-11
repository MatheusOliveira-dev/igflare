import { describe, it, expect } from 'vitest';
import { pandoRequest, pandoRoot, stripPandoMarkers } from './pando';
import { IgApiError } from '../../errors/api-errors';
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

describe('pandoRoot', () => {
  it('finds the value at the root field by the key prefix', () => {
    const json = { data: { '1$example_root(arg:$arg)': { ok: true }, other: 1 } };
    expect(pandoRoot(json, 'example_root', 'thing')).toEqual({ ok: true });
  });

  it('returns a root that is not an object as it is', () => {
    expect(pandoRoot({ data: { '1$example_root': true } }, 'example_root', 'thing')).toBe(true);
  });

  it('throws with the server message when the query was refused', () => {
    const json = { data: null, errors: [{ message: 'missing_required_variable_value' }] };
    expect(() => pandoRoot(json, 'example_root', 'thing')).toThrow(IgApiError);
    expect(() => pandoRoot(json, 'example_root', 'thing')).toThrow(
      'The thing was refused: missing_required_variable_value',
    );
  });

  it('throws when the root field is not in the answer and there is no message', () => {
    expect(() => pandoRoot({ data: { '1$other': {} } }, 'example_root', 'thing')).toThrow(
      'The thing was refused',
    );
  });
});

describe('stripPandoMarkers', () => {
  it('drops type markers and the arguments of nested fields, at any depth', () => {
    expect(
      stripPandoMarkers({
        '1fvalue': 3,
        '1ltotal': 4,
        '1$active_times(timezone:$timezone)': { slots: [{ '1fvalue': 0, hour: 3 }] },
        label: 'x',
      }),
    ).toEqual({ value: 3, total: 4, active_times: { slots: [{ value: 0, hour: 3 }] }, label: 'x' });
  });

  it('leaves other keys and plain values alone', () => {
    expect(stripPandoMarkers({ '1abc': 1, '1': 2, list: [1, 'a', null] })).toEqual({
      '1abc': 1,
      '1': 2,
      list: [1, 'a', null],
    });
    expect(stripPandoMarkers('text')).toBe('text');
  });
});
