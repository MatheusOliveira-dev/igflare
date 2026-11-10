import { describe, it, expect } from 'vitest';
import { getMediaInfo } from './media';
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

describe('getMediaInfo', () => {
  it('requests the media info endpoint and parses the single item', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      items: [{ pk: 1, id: '1_9', code: 'abc', media_type: 1, like_count: 50 }],
    });

    const media = await getMediaInfo(client, '1_9');

    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/media/1_9/info/');
    expect(transport.requests[0]?.method).toBe('GET');
    expect(media.code).toBe('abc');
    expect(media.like_count).toBe(50);
  });

  it('throws when the response has no media item', async () => {
    const { client } = clientReturning({ status: 'ok', items: [] });
    await expect(getMediaInfo(client, '1_9')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('throws a typed schema error on a shape mismatch', async () => {
    const { client } = clientReturning({ status: 'ok', items: [{ pk: 1, like_count: 'many' }] });
    await expect(getMediaInfo(client, '1_9')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});
