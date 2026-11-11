import { describe, it, expect } from 'vitest';
import { sendVideo, sendVoice } from './direct-attachments';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { parseMp4Meta } from '../../core/media/mp4';
import { sampleMp4 } from '../../core/media/__fixtures__/mp4';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const THREAD = '340282366841710301244259330242664032634';
const SENT = { status: 'ok', payload: { item_id: 'i1', thread_id: 't1', timestamp: '9' } };
const MP4 = sampleMp4();

/** The first bytes of an AAC clip in an MP4 container: a box of type `ftyp`. */
const M4A = new Uint8Array([
  0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0,
]);

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function clientWith(handler: (req: HttpRequest) => HttpResponse): {
  client: PrivateClient;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(handler);
  const session = createSession({ auth: { userId: '10000000002' } });
  return { client: new PrivateClient({ transport, session }), transport };
}

function form(request: HttpRequest | undefined): Record<string, string> {
  const body = typeof request?.body === 'string' ? request.body : '';
  return Object.fromEntries(new URLSearchParams(body));
}

function signed(request: HttpRequest | undefined): Record<string, unknown> {
  const value = form(request)['signed_body'] ?? '';
  return JSON.parse(value.slice(value.indexOf('.') + 1)) as Record<string, unknown>;
}

/** The upload host answers the offset question with 0 and the upload with a media id. */
function uploadHost(offset = 0): (req: HttpRequest) => HttpResponse {
  return (req) => {
    if (req.url.includes('rupload.facebook.com')) {
      return req.method === 'GET'
        ? json({ offset })
        : { status: 200, headers: {}, body: '{"media_id":1234567890123456789}' };
    }
    return json(SENT);
  };
}

describe('sendVideo', () => {
  it('asks for the upload offset, uploads the bytes, then attaches them to the thread', async () => {
    const { client, transport } = clientWith(uploadHost());

    const result = await sendVideo(client, MP4, { threadId: THREAD });

    const [offset, upload, attach] = transport.requests;
    expect(offset?.method).toBe('GET');
    expect(offset?.url).toMatch(
      /^https:\/\/rupload\.facebook\.com\/messenger_video\/[0-9a-f]{32}-0-/,
    );
    expect(offset?.headers['video_type']).toBe('FILE_ATTACHMENT');
    expect(upload?.method).toBe('POST');
    expect(upload?.url).toBe(offset?.url);
    expect(upload?.body).toEqual(MP4);
    expect(upload?.headers['X-Entity-Type']).toBe('video/mp4');
    expect(upload?.headers['X-Entity-Length']).toBe(String(MP4.length));
    expect(upload?.headers['Content-Length']).toBe(String(MP4.length));
    expect(upload?.headers['Offset']).toBe('0');
    expect(upload?.headers['segment-type']).toBe('3');
    expect(upload?.headers['x_fb_video_waterfall_id']).toMatch(/^\d+_[0-9A-F]{12}_Mixed_0$/);
    expect(upload?.headers['IG-INTENDED-USER-ID']).toBe('10000000002');

    expect(attach?.url).toContain('/api/v1/direct_v2/threads/broadcast/raven_attachment/?video=1');
    const body = signed(attach);
    // 19-digit ids stay exact (lossless parse), not rounded through a number.
    expect(body['attachment_fbid']).toBe('1234567890123456789');
    expect(body['video_result']).toBe('1234567890123456789');
    expect(body['thread_ids']).toBe(`[${THREAD}]`);
    expect(body['original_media_type']).toBe('2');
    expect(body['_uid']).toBe('10000000002');
    expect(result.item_id).toBe('i1');
  });

  it('describes the video from the file: size, length and the clip', async () => {
    const { client, transport } = clientWith(uploadHost());
    const meta = parseMp4Meta(MP4);

    await sendVideo(client, MP4, { threadId: THREAD });

    const body = signed(transport.requests[2]);
    expect(body['length']).toBe(meta.durationMs / 1000);
    expect(body['clips']).toEqual([
      { length: meta.durationMs / 1000, source_type: '3', camera_position: 'back' },
    ]);
    expect(body['extra']).toEqual({ source_width: meta.width, source_height: meta.height });
    expect(JSON.parse(String(body['media_transformation_info']))).toMatchObject({
      width: String(meta.width),
      height: String(meta.height),
    });
  });

  it('resumes from the offset the host reports', async () => {
    const { client, transport } = clientWith(uploadHost(10));
    await sendVideo(client, MP4, { threadId: THREAD });
    const upload = transport.requests[1];
    expect(upload?.headers['Offset']).toBe('10');
    expect(upload?.body).toEqual(MP4.subarray(10));
    expect(upload?.headers['Content-Length']).toBe(String(MP4.length - 10));
    expect(upload?.headers['X-Entity-Length']).toBe(String(MP4.length));
  });

  it('starts over when the reported offset makes no sense', async () => {
    const { client, transport } = clientWith(uploadHost(MP4.length + 5));
    await sendVideo(client, MP4, { threadId: THREAD });
    expect(transport.requests[1]?.headers['Offset']).toBe('0');
  });

  it('looks up the existing thread when given user ids', async () => {
    const { client, transport } = clientWith((req) =>
      req.url.includes('get_by_participants')
        ? json({ status: 'ok', thread: { thread_id: '77' } })
        : uploadHost()(req),
    );
    await sendVideo(client, MP4, { userIds: ['42'] });
    expect(signed(transport.requests.at(-1))['thread_ids']).toBe('[77]');
  });

  it('needs an existing thread for a list of users', async () => {
    const { client } = clientWith(() => json({ status: 'ok' }));
    await expect(sendVideo(client, MP4, { userIds: ['42'] })).rejects.toThrow(
      'A direct video needs an existing thread',
    );
  });

  it('rejects bytes that are not an MP4 before any request', async () => {
    const { client, transport } = clientWith(() => json(SENT));
    await expect(
      sendVideo(client, new Uint8Array([1, 2, 3]), { threadId: THREAD }),
    ).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws a typed error when the upload returns no media id', async () => {
    const { client } = clientWith((req) =>
      req.url.includes('rupload.facebook.com') ? json({ offset: 0 }) : json(SENT),
    );
    await expect(sendVideo(client, MP4, { threadId: THREAD })).rejects.toBeInstanceOf(
      ClientSchemaError,
    );
  });
});

describe('sendVoice', () => {
  it('uploads the clip as audio, then sends it as a voice attachment', async () => {
    const { client, transport } = clientWith(uploadHost());

    const result = await sendVoice(client, M4A, { threadId: THREAD });

    const [offset, upload, attach] = transport.requests;
    expect(offset?.url).toMatch(/^https:\/\/rupload\.facebook\.com\/messenger_audio\/\d+_0_-?\d+$/);
    expect(offset?.headers['audio_type']).toBe('FILE_ATTACHMENT');
    expect(upload?.body).toEqual(M4A);
    expect(upload?.headers['X-Entity-Type']).toBe('audio/mp4');

    expect(attach?.url).toContain('/api/v1/direct_v2/threads/broadcast/voice_attachment/');
    expect(attach?.body).not.toContain('signed_body');
    const body = form(attach);
    expect(body['attachment_fbid']).toBe('1234567890123456789');
    expect(body['thread_ids']).toBe(`[${THREAD}]`);
    expect(body['waveform_sampling_frequency_hz']).toBe('10');
    expect(body['upload_id']).toMatch(/^\d{13}$/);
    expect(body['client_context']).toBe(body['mutation_token']);
    expect(result.item_id).toBe('i1');
  });

  it('draws a varied waveform of 70 bars by default', async () => {
    const { client, transport } = clientWith(uploadHost());
    await sendVoice(client, M4A, { threadId: THREAD });
    const bars = JSON.parse(form(transport.requests[2])['waveform'] ?? '[]') as number[];
    expect(bars).toHaveLength(70);
    expect(bars.every((bar) => bar >= 0.2 && bar <= 0.95)).toBe(true);
    expect(new Set(bars).size).toBeGreaterThan(5);
  });

  it('sends the waveform it was given', async () => {
    const { client, transport } = clientWith(uploadHost());
    const waveform = Array.from({ length: 70 }, () => 0.5);
    await sendVoice(client, M4A, { threadId: THREAD }, { waveform });
    expect(JSON.parse(form(transport.requests[2])['waveform'] ?? '[]')).toEqual(waveform);
  });

  it('refuses a waveform of the wrong size or range, before any request', async () => {
    const { client, transport } = clientWith(uploadHost());
    await expect(
      sendVoice(client, M4A, { threadId: THREAD }, { waveform: [0.5] }),
    ).rejects.toBeInstanceOf(IgError);
    await expect(
      sendVoice(client, M4A, { threadId: THREAD }, { waveform: Array(70).fill(2) as number[] }),
    ).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('rejects bytes that are not an MP4 container before any request', async () => {
    const { client, transport } = clientWith(() => json(SENT));
    await expect(
      sendVoice(client, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { threadId: THREAD }),
    ).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('looks up the existing thread when given user ids', async () => {
    const { client, transport } = clientWith((req) =>
      req.url.includes('get_by_participants')
        ? json({ status: 'ok', thread: { thread_id: '77' } })
        : uploadHost()(req),
    );
    await sendVoice(client, M4A, { userIds: ['42'] });
    expect(form(transport.requests.at(-1))['thread_ids']).toBe('[77]');
  });
});
