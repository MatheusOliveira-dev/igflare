import { describe, it, expect } from 'vitest';
import { sendLink, reactToMessage, shareMedia, shareProfile, sendPhoto } from './direct-send';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const THREAD = '340282366841710301244259330242664032634';
const ITEM = '33099207189847068621439624456175616';
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03,
]);

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

const SENT = { status: 'ok', payload: { item_id: 'i1', thread_id: 't1', timestamp: '9' } };

function clientWith(handler: (req: HttpRequest) => HttpResponse): {
  client: PrivateClient;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(handler);
  const session = createSession({ auth: { userId: '10000000002' } });
  return { client: new PrivateClient({ transport, session }), transport };
}

function fields(request: HttpRequest | undefined): Record<string, string> {
  const body = typeof request?.body === 'string' ? request.body : '';
  return Object.fromEntries(new URLSearchParams(body));
}

describe('sendLink', () => {
  it('posts the text and the extracted urls to the link broadcast, as a plain form', async () => {
    const { client, transport } = clientWith(() => json(SENT));

    const result = await sendLink(client, 'veja https://igflare.dev e http://x.io/a', {
      threadId: THREAD,
    });

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v1/direct_v2/threads/broadcast/link/');
    expect(request?.body).not.toContain('signed_body');
    const body = fields(request);
    expect(body['link_text']).toBe('veja https://igflare.dev e http://x.io/a');
    expect(body['link_urls']).toBe('["https://igflare.dev","http://x.io/a"]');
    expect(body['send_attribution']).toBe('message_button');
    expect(body['client_context']).toMatch(/^68000\d{14}$/);
    expect(body['offline_threading_id']).toBe(body['client_context']);
    expect(body['_uid']).toBe('10000000002');
    expect(result.item_id).toBe('i1');
  });

  it('keeps a 39-digit thread id exact in the thread_ids array', async () => {
    const { client, transport } = clientWith(() => json(SENT));
    await sendLink(client, 'https://a.b', { threadId: THREAD });
    expect(fields(transport.requests[0])['thread_ids']).toBe(`[${THREAD}]`);
  });

  it('nests user ids for a send to users', async () => {
    const { client, transport } = clientWith(() => json(SENT));
    await sendLink(client, 'https://a.b', { userIds: ['111', '222'] });
    expect(fields(transport.requests[0])['recipient_users']).toBe('[[111,222]]');
  });

  it('requires a link in the text and numeric ids', async () => {
    const { client, transport } = clientWith(() => json(SENT));
    await expect(sendLink(client, 'no link here', { threadId: THREAD })).rejects.toBeInstanceOf(
      IgError,
    );
    await expect(sendLink(client, 'https://a.b', { threadId: 'x/../y' })).rejects.toBeInstanceOf(
      IgError,
    );
    expect(transport.requests).toHaveLength(0);
  });

  it('throws a typed error when the send result has the wrong shape', async () => {
    const { client } = clientWith(() => json({ status: 'ok', payload: { item_id: 5 } }));
    await expect(sendLink(client, 'https://a.b', { threadId: THREAD })).rejects.toBeInstanceOf(
      ClientSchemaError,
    );
  });
});

describe('reactToMessage', () => {
  it('adds a heart reaction by default', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok' }));

    await reactToMessage(client, THREAD, ITEM);

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v1/direct_v2/threads/broadcast/reaction/');
    const body = fields(request);
    expect(body['reaction_status']).toBe('created');
    expect(body['item_id']).toBe(ITEM);
    expect(body['emoji']).toBe('❤');
    expect(body['thread_ids']).toBe(`["${THREAD}"]`);
    expect(body['send_attribution']).toBe('message_reaction');
  });

  it('removes a reaction and takes a custom emoji', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok' }));
    await reactToMessage(client, THREAD, ITEM, { emoji: '\u{1F602}', remove: true });
    const body = fields(transport.requests[0]);
    expect(body['reaction_status']).toBe('deleted');
    expect(body['emoji']).toBe('\u{1F602}');
  });
});

describe('shareMedia and shareProfile', () => {
  it('shares a post with its media type in the query', async () => {
    const { client, transport } = clientWith(() => json(SENT));

    await shareMedia(
      client,
      '4000000000000000001_10000000002',
      { threadId: THREAD },
      {
        mediaType: 'video',
      },
    );

    const request = transport.requests[0];
    expect(request?.url).toContain('/threads/broadcast/media_share/?media_type=video');
    const body = fields(request);
    expect(body['media_id']).toBe('4000000000000000001_10000000002');
    expect(body['inventory_source']).toBe('media_or_ad');
  });

  it('rejects a media id that is not a full id', async () => {
    const { client } = clientWith(() => json(SENT));
    await expect(shareMedia(client, 'abc', { threadId: THREAD })).rejects.toBeInstanceOf(IgError);
  });

  it('shares a profile', async () => {
    const { client, transport } = clientWith(() => json(SENT));

    await shareProfile(client, '10000000001', { threadId: THREAD });

    expect(transport.requests[0]?.url).toContain('/threads/broadcast/profile/');
    expect(fields(transport.requests[0])['profile_user_id']).toBe('10000000001');
  });
});

describe('sendPhoto', () => {
  it('uploads the bytes to the messenger host, then attaches them to the thread', async () => {
    const { client, transport } = clientWith((req) =>
      req.url.includes('rupload.facebook.com')
        ? // The raw body, as the server sends it: a JS number literal would round first.
          { status: 200, headers: {}, body: '{"media_id":1234567890123456789}' }
        : json(SENT),
    );

    const result = await sendPhoto(client, JPEG, { threadId: THREAD });

    const upload = transport.requests[0];
    expect(upload?.url).toMatch(
      /^https:\/\/rupload\.facebook\.com\/messenger_image\/fb_uploader_\d+$/,
    );
    expect(upload?.body).toBe(JPEG); // raw bytes
    expect(upload?.headers['X-Entity-Length']).toBe(String(JPEG.length));
    expect(upload?.headers['image_type']).toBe('FILE_ATTACHMENT');

    const attach = transport.requests[1];
    expect(attach?.url).toContain('/threads/broadcast/photo_attachment/');
    const body = fields(attach);
    // 19-digit media ids stay exact (lossless parse), not rounded through a number.
    expect(body['attachment_fbid']).toBe('1234567890123456789');
    expect(body['thread_ids']).toBe(`[${THREAD}]`);
    expect(result.item_id).toBe('i1');
  });

  it('looks up the existing thread when given user ids', async () => {
    const { client, transport } = clientWith((req) => {
      if (req.url.includes('get_by_participants'))
        return json({ status: 'ok', thread: { thread_id: '77' } });
      if (req.url.includes('rupload.facebook.com')) return json({ media_id: '55' });
      return json(SENT);
    });

    await sendPhoto(client, JPEG, { userIds: ['42'] });

    const attach = transport.requests.at(-1);
    expect(fields(attach)['thread_ids']).toBe('[77]');
  });

  it('needs an existing thread for a list of users', async () => {
    const { client } = clientWith(() => json({ status: 'ok' }));
    await expect(sendPhoto(client, JPEG, { userIds: ['42'] })).rejects.toBeInstanceOf(IgError);
  });

  it('rejects bytes that are not a JPEG before any request', async () => {
    const { client, transport } = clientWith(() => json(SENT));
    await expect(
      sendPhoto(client, new Uint8Array([1, 2, 3]), { threadId: THREAD }),
    ).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws a typed error when the upload returns no media id', async () => {
    const { client } = clientWith((req) =>
      req.url.includes('rupload.facebook.com') ? json({ status: 'ok' }) : json(SENT),
    );
    await expect(sendPhoto(client, JPEG, { threadId: THREAD })).rejects.toBeInstanceOf(
      ClientSchemaError,
    );
  });
});
