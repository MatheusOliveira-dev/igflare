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

  it('does not send usertags on a caption-only edit, so existing tags are kept', async () => {
    const { client, transport } = clientReturning(EDITED);
    await editMedia(client, MEDIA, { caption: 'novo' });
    expect(signedPayload(transport.requests[0])).not.toHaveProperty('usertags');
  });

  it('tags people with exact ids and positions', async () => {
    const { client, transport } = clientReturning(EDITED);
    await editMedia(client, MEDIA, {
      caption: 'x',
      tag: [{ userId: '10000000001', x: 0.5, y: 0.25 }],
    });
    expect(signedPayload(transport.requests[0])['usertags']).toBe(
      '{"in":[{"user_id":10000000001,"position":[0.5,0.25]}]}',
    );
  });

  it('keeps a 64-bit user id exact in the tag JSON', async () => {
    const { client, transport } = clientReturning(EDITED);
    await editMedia(client, MEDIA, {
      caption: 'x',
      tag: [{ userId: '9007199254740993', x: 0, y: 1 }],
    });
    expect(signedPayload(transport.requests[0])['usertags']).toContain(
      '"user_id":9007199254740993',
    );
  });

  it('untags by id with the removed list (an empty tag list alone removes nothing)', async () => {
    const { client, transport } = clientReturning(EDITED);
    await editMedia(client, MEDIA, { caption: 'x', untag: ['10000000001'] });
    expect(signedPayload(transport.requests[0])['usertags']).toBe(
      '{"in":[],"removed":[10000000001]}',
    );
  });

  it('can tag and untag in one edit', async () => {
    const { client, transport } = clientReturning(EDITED);
    await editMedia(client, MEDIA, {
      caption: 'x',
      tag: [{ userId: '1', x: 0.1, y: 0.2 }],
      untag: ['2', '3'],
    });
    expect(signedPayload(transport.requests[0])['usertags']).toBe(
      '{"in":[{"user_id":1,"position":[0.1,0.2]}],"removed":[2,3]}',
    );
  });

  it('rejects a bad tag position or a non-numeric id before any request', async () => {
    const { client, transport } = clientReturning(EDITED);
    await expect(
      editMedia(client, MEDIA, { caption: 'x', tag: [{ userId: '1', x: 2, y: 0 }] }),
    ).rejects.toBeInstanceOf(IgError);
    await expect(
      editMedia(client, MEDIA, { caption: 'x', tag: [{ userId: 'a', x: 0, y: 0 }] }),
    ).rejects.toBeInstanceOf(IgError);
    await expect(
      editMedia(client, MEDIA, { caption: 'x', untag: ['../x'] }),
    ).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('reads the applied tags back from usertags on the returned media', async () => {
    const { client } = clientReturning({
      status: 'ok',
      media: {
        pk: 1,
        usertags: {
          in: [{ position: [0.5, 0.5], user: { pk: 10000000001, username: 'matheus' } }],
        },
      },
    });
    const media = await editMedia(client, MEDIA, {
      caption: 'x',
      tag: [{ userId: '10000000001', x: 0.5, y: 0.5 }],
    });
    expect(media.usertags?.in?.[0]?.user?.username).toBe('matheus');
    expect(media.usertags?.in?.[0]?.position).toEqual([0.5, 0.5]);
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
