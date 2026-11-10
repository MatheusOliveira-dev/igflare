import { describe, it, expect } from 'vitest';
import { uploadPhoto, uploadVideo, uploadStoryPhoto } from './upload';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';

/** A minimal 400x300 JPEG marker stream. */
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0x90, 0x03,
]);

function signedPayload(body: string | Uint8Array | undefined): Record<string, unknown> {
  const form = new URLSearchParams(typeof body === 'string' ? body : '');
  const signed = form.get('signed_body') ?? '';
  return JSON.parse(signed.slice(signed.indexOf('.') + 1)) as Record<string, unknown>;
}

function uploader(configure: unknown): { client: PrivateClient; transport: FakeTransport } {
  const transport = new FakeTransport((req: HttpRequest) =>
    req.url.includes('rupload_igphoto')
      ? { status: 200, headers: {}, body: JSON.stringify({ upload_id: 'U1', status: 'ok' }) }
      : { status: 200, headers: {}, body: JSON.stringify(configure) },
  );
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

describe('uploadPhoto', () => {
  it('ruploads the raw bytes then configures the post', async () => {
    const { client, transport } = uploader({
      status: 'ok',
      media: { pk: 1, code: 'abc', media_type: 1 },
    });

    const media = await uploadPhoto(client, JPEG, { caption: 'hi' });

    const rupload = transport.requests[0];
    expect(rupload?.url).toContain('https://i.instagram.com/rupload_igphoto/');
    expect(rupload?.method).toBe('POST');
    expect(rupload?.body).toBe(JPEG); // raw bytes, not a form body
    expect(rupload?.headers['X-Entity-Length']).toBe(String(JPEG.length));
    expect(rupload?.headers['Content-Type']).toBe('application/octet-stream');
    const params = JSON.parse(rupload?.headers['X-Instagram-Rupload-Params'] ?? '{}') as {
      media_type: string;
    };
    expect(params.media_type).toBe('1');

    const configure = transport.requests[1];
    expect(configure?.url).toContain('/api/v1/media/configure/');
    const payload = signedPayload(configure?.body) as {
      upload_id: string;
      caption: string;
      edits: { crop_original_size: number[] };
    };
    expect(payload.upload_id).toBe('U1');
    expect(payload.caption).toBe('hi');
    expect(payload.edits.crop_original_size).toEqual([400, 300]);

    expect(media.code).toBe('abc');
  });

  it('throws a typed schema error when configure returns no media', async () => {
    const { client } = uploader({ status: 'ok' });
    await expect(uploadPhoto(client, JPEG)).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('uploadVideo', () => {
  it('ruploads the video and cover then configures with metadata', async () => {
    const mp4 = new Uint8Array([0, 1, 2, 3]);
    const transport = new FakeTransport((req: HttpRequest) => {
      if (req.url.includes('rupload_igvideo')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ upload_id: 'V1', status: 'ok' }),
        };
      }
      if (req.url.includes('rupload_igphoto')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ upload_id: 'V1', status: 'ok' }),
        };
      }
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ status: 'ok', media: { pk: 1, code: 'vid', media_type: 2 } }),
      };
    });
    const client = new PrivateClient({ transport, session: createSession() });

    const media = await uploadVideo(client, mp4, JPEG, {
      caption: 'clip',
      durationMs: 8000,
      width: 720,
      height: 1280,
    });

    const video = transport.requests[0];
    expect(video?.url).toContain('/rupload_igvideo/');
    expect(video?.headers['X-Entity-Type']).toBe('video/mp4');
    const vparams = JSON.parse(video?.headers['X-Instagram-Rupload-Params'] ?? '{}') as {
      media_type: string;
      upload_media_duration_ms: string;
    };
    expect(vparams.media_type).toBe('2');
    expect(vparams.upload_media_duration_ms).toBe('8000');

    const cover = transport.requests[1];
    expect(cover?.url).toContain('/rupload_igphoto/');
    expect(cover?.body).toBe(JPEG);

    const configure = transport.requests[2];
    expect(configure?.url).toContain('/api/v1/media/configure/?video=1');
    expect(signedPayload(configure?.body)).toMatchObject({ length: 8, clips: [{ length: 8 }] });

    expect(media.code).toBe('vid');
  });
});

describe('uploadStoryPhoto', () => {
  it('ruploads then configures to story with source_type 3', async () => {
    const transport = new FakeTransport((req: HttpRequest) =>
      req.url.includes('rupload_igphoto')
        ? { status: 200, headers: {}, body: JSON.stringify({ upload_id: 'S1', status: 'ok' }) }
        : {
            status: 200,
            headers: {},
            body: JSON.stringify({ status: 'ok', media: { pk: 1, code: 'st' } }),
          },
    );
    const client = new PrivateClient({ transport, session: createSession() });

    const media = await uploadStoryPhoto(client, JPEG);

    const configure = transport.requests[1];
    expect(configure?.url).toContain('/api/v1/media/configure_to_story/');
    expect(signedPayload(configure?.body)['source_type']).toBe('3');
    expect(media.code).toBe('st');
  });
});
