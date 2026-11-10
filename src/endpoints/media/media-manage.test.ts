import { describe, it, expect } from 'vitest';
import { editMedia, archiveMedia, unarchiveMedia, pinMedia, unpinMedia } from './media-manage';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const MEDIA = '4000000000000000002_10000000002';

function clientReturning(body: unknown): { client: PrivateClient; transport: FakeTransport } {
  const transport = new FakeTransport(() => ({
    status: 200,
    headers: {},
    body: JSON.stringify(body),
  }));
  const session = createSession({ auth: { userId: '10000000002' } });
  return { client: new PrivateClient({ transport, session }), transport };
}

function signedPayload(request: HttpRequest | undefined): Record<string, unknown> {
  const body = typeof request?.body === 'string' ? request.body : '';
  const signed = new URLSearchParams(body).get('signed_body') ?? '';
  return JSON.parse(signed.slice(signed.indexOf('.') + 1)) as Record<string, unknown>;
}

const EDITED = { status: 'ok', media: { pk: 1, code: 'abc', caption: { text: 'novo' } } };

describe('editMedia', () => {
  it('edits the caption and returns the updated media', async () => {
    const { client, transport } = clientReturning(EDITED);

    const media = await editMedia(client, MEDIA, { caption: 'novo' });

    expect(transport.requests[0]?.url).toContain(`/api/v1/media/${MEDIA}/edit_media/`);
    expect(signedPayload(transport.requests[0])['caption_text']).toBe('novo');
    expect(media.caption?.text).toBe('novo');
  });

  it('throws a typed error when the response has no media', async () => {
    const { client } = clientReturning({ status: 'ok' });
    await expect(editMedia(client, MEDIA, { caption: 'x' })).rejects.toBeInstanceOf(
      ClientSchemaError,
    );
  });
});

describe('archive and pin', () => {
  it('archives and unarchives a media', async () => {
    const a = clientReturning({ status: 'ok' });
    await archiveMedia(a.client, MEDIA);
    expect(a.transport.requests[0]?.url).toContain(`/media/${MEDIA}/only_me/`);
    expect(signedPayload(a.transport.requests[0])['media_id']).toBe(MEDIA);

    const b = clientReturning({ status: 'ok' });
    await unarchiveMedia(b.client, MEDIA);
    expect(b.transport.requests[0]?.url).toContain(`/media/${MEDIA}/undo_only_me/`);
  });

  it('pins and unpins to the profile using the numeric pk only', async () => {
    const a = clientReturning({ status: 'ok' });
    await pinMedia(a.client, MEDIA);
    expect(a.transport.requests[0]?.url).toContain('/api/v1/users/pin_timeline_media/');
    expect(signedPayload(a.transport.requests[0])['post_id']).toBe('4000000000000000002');

    const b = clientReturning({ status: 'ok' });
    await unpinMedia(b.client, '4000000000000000002');
    expect(b.transport.requests[0]?.url).toContain('/api/v1/users/unpin_timeline_media/');
    expect(signedPayload(b.transport.requests[0])['post_id']).toBe('4000000000000000002');
  });

  it('rejects a media id that is not numeric', async () => {
    const { client, transport } = clientReturning({ status: 'ok' });
    await expect(archiveMedia(client, '../x')).rejects.toBeInstanceOf(IgError);
    await expect(pinMedia(client, 'abc')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });
});
