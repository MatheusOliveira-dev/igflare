import { describe, it, expect } from 'vitest';
import {
  createHighlight,
  deleteHighlight,
  editHighlight,
  getHighlight,
  listHighlights,
} from './highlight';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const OWNER = '10000000001';
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03,
]);

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function clientWith(handler: (req: HttpRequest) => HttpResponse): {
  client: PrivateClient;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(handler);
  const session = createSession({ auth: { userId: OWNER } });
  return { client: new PrivateClient({ transport, session }), transport };
}

function signed(request: HttpRequest | undefined): Record<string, unknown> {
  const form = new URLSearchParams(typeof request?.body === 'string' ? request.body : '');
  const value = form.get('signed_body') ?? '';
  return JSON.parse(value.slice(value.indexOf('.') + 1)) as Record<string, unknown>;
}

const HIGHLIGHT = { id: 'highlight:17900000000000001', title: 'Trips', media_count: 2 };

describe('listHighlights', () => {
  it('reads the highlights on a profile', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', tray: [HIGHLIGHT] }));

    const highlights = await listHighlights(client, OWNER);

    const request = transport.requests[0];
    expect(request?.url).toContain(`/api/v1/highlights/${OWNER}/highlights_tray/`);
    expect(request?.method).toBe('GET');
    expect(request?.url).toContain('supported_capabilities_new=');
    expect(request?.url).toContain('phone_id=');
    expect(highlights[0]?.id).toBe('highlight:17900000000000001');
    expect(highlights[0]?.title).toBe('Trips');
  });

  it('is empty when the profile has none', async () => {
    const { client } = clientWith(() => json({ status: 'ok' }));
    expect(await listHighlights(client, OWNER)).toEqual([]);
  });

  it('refuses a user id that is not numeric, before any request', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', tray: [] }));
    await expect(listHighlights(client, '1/../x')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when an entry has no id', async () => {
    const { client } = clientWith(() => json({ status: 'ok', tray: [{ title: 'x' }] }));
    await expect(listHighlights(client, OWNER)).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('getHighlight', () => {
  const reels = { status: 'ok', reels: { 'highlight:5': { ...HIGHLIGHT, items: [{ pk: 1 }] } } };

  it('reads one highlight with its stories', async () => {
    const { client, transport } = clientWith(() => json(reels));

    const highlight = await getHighlight(client, 'highlight:5');

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v1/feed/reels_media/');
    expect(request?.method).toBe('POST');
    expect(signed(request)['user_ids']).toEqual(['highlight:5']);
    expect(signed(request)['source']).toBe('profile');
    expect(highlight.items).toHaveLength(1);
  });

  it('accepts the bare number too', async () => {
    const { client, transport } = clientWith(() => json(reels));
    await getHighlight(client, '5');
    expect(signed(transport.requests[0])['user_ids']).toEqual(['highlight:5']);
  });

  it('throws when the highlight is not in the answer', async () => {
    const { client } = clientWith(() => json({ status: 'ok', reels: {} }));
    await expect(getHighlight(client, '5')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('refuses an id that is not numeric, before any request', async () => {
    const { client, transport } = clientWith(() => json(reels));
    await expect(getHighlight(client, 'highlight:5/../x')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });
});

describe('createHighlight', () => {
  const created = { status: 'ok', reel: HIGHLIGHT };

  it('creates a highlight from stories, using the first as the cover', async () => {
    const { client, transport } = clientWith(() => json(created));

    const highlight = await createHighlight(client, '  Trips ', [
      '4000000000000000001_10000000001',
      '4000000000000000002_10000000001',
    ]);

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v1/highlights/create_reel/');
    const body = signed(request);
    expect(body['title']).toBe('Trips');
    expect(body['source']).toBe('self_profile');
    expect(body['_uid']).toBe(OWNER);
    expect(JSON.parse(String(body['media_ids']))).toEqual([
      '4000000000000000001_10000000001',
      '4000000000000000002_10000000001',
    ]);
    expect(JSON.parse(String(body['cover']))).toEqual({
      media_id: '4000000000000000001_10000000001',
      crop_rect: '[0.0,0.21830457,1.0,0.78094524]',
    });
    expect(highlight.id).toBe('highlight:17900000000000001');
  });

  it('completes a bare story pk with the account id and honors a chosen cover', async () => {
    const { client, transport } = clientWith(() => json(created));
    await createHighlight(client, 'x', ['11', '12'], { coverStoryId: '12' });
    const body = signed(transport.requests[0]);
    expect(JSON.parse(String(body['media_ids']))).toEqual([`11_${OWNER}`, `12_${OWNER}`]);
    expect((JSON.parse(String(body['cover'])) as { media_id: string }).media_id).toBe(
      `12_${OWNER}`,
    );
  });

  it('refuses an empty title, no stories or a bad story id, before any request', async () => {
    const { client, transport } = clientWith(() => json(created));
    await expect(createHighlight(client, '  ', ['1_2'])).rejects.toBeInstanceOf(IgError);
    await expect(createHighlight(client, 'x', [])).rejects.toBeInstanceOf(IgError);
    await expect(createHighlight(client, 'x', ['1_2/../x'])).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when the answer has no highlight', async () => {
    const { client } = clientWith(() => json({ status: 'ok' }));
    await expect(createHighlight(client, 'x', ['1_2'])).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('editHighlight', () => {
  const edited = { status: 'ok', reel: HIGHLIGHT };

  it('changes the title and the stories', async () => {
    const { client, transport } = clientWith(() => json(edited));

    await editHighlight(client, 'highlight:5', {
      title: ' New ',
      addStoryIds: ['21_10000000001'],
      removeStoryIds: ['22_10000000001'],
    });

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v1/highlights/highlight:5/edit_reel/');
    const body = signed(request);
    expect(body['title']).toBe('New');
    expect(JSON.parse(String(body['added_media_ids']))).toEqual(['21_10000000001']);
    expect(JSON.parse(String(body['removed_media_ids']))).toEqual(['22_10000000001']);
    expect(body).not.toHaveProperty('cover');
  });

  it('sends empty lists and no title when only the cover changes', async () => {
    const { client, transport } = clientWith(() => json(edited));
    await editHighlight(client, '5', { coverStoryId: '21_10000000001' });
    const body = signed(transport.requests[0]);
    expect(body['added_media_ids']).toBe('[]');
    expect(body['removed_media_ids']).toBe('[]');
    expect(body).not.toHaveProperty('title');
    expect((JSON.parse(String(body['cover'])) as { media_id: string }).media_id).toBe(
      '21_10000000001',
    );
  });

  it('uploads a picture and uses it as the cover', async () => {
    const { client, transport } = clientWith((req) =>
      req.url.includes('rupload_igphoto') ? json({ upload_id: 'U9', status: 'ok' }) : json(edited),
    );

    await editHighlight(client, '5', { coverJpeg: JPEG });

    expect(transport.requests[0]?.url).toContain('/rupload_igphoto/');
    const body = signed(transport.requests[1]);
    expect(JSON.parse(String(body['cover']))).toEqual({
      upload_id: 'U9',
      crop_rect: '[0.0,0.0,1.0,1.0]',
    });
  });

  it('refuses both kinds of cover, a bad picture, an empty title or a bad id, before any request', async () => {
    const { client, transport } = clientWith(() => json(edited));
    await expect(
      editHighlight(client, '5', { coverStoryId: '1_2', coverJpeg: JPEG }),
    ).rejects.toBeInstanceOf(IgError);
    await expect(
      editHighlight(client, '5', { coverJpeg: new Uint8Array([1, 2, 3]) }),
    ).rejects.toBeInstanceOf(IgError);
    await expect(editHighlight(client, '5', { title: ' ' })).rejects.toBeInstanceOf(IgError);
    await expect(editHighlight(client, '5/../x', { title: 'a' })).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when the answer has no highlight', async () => {
    const { client } = clientWith(() => json({ status: 'ok' }));
    await expect(editHighlight(client, '5', { title: 'a' })).rejects.toBeInstanceOf(
      ClientSchemaError,
    );
  });
});

describe('deleteHighlight', () => {
  it('deletes the highlight by its id', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok' }));
    await deleteHighlight(client, 'highlight:17900000000000001');
    expect(transport.requests[0]?.url).toContain(
      '/api/v1/highlights/highlight:17900000000000001/delete_reel/',
    );
    expect(transport.requests[0]?.method).toBe('POST');
  });

  it('refuses an id that is not numeric, before any request', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok' }));
    await expect(deleteHighlight(client, 'x')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });
});
