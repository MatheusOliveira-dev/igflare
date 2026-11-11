import { describe, it, expect, vi } from 'vitest';
import { uploadAlbum, uploadPhoto, uploadReel, uploadVideo, uploadStoryPhoto } from './upload';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError, PleaseWaitError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';
import { sampleMp4 } from '../../core/media/__fixtures__/mp4';
import { parseMp4Meta } from '../../core/media/mp4';

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

describe('uploadVideo configure retries', () => {
  function videoClient(configure: () => { status: number; body: unknown }): {
    client: PrivateClient;
    configures: () => number;
  } {
    let count = 0;
    const transport = new FakeTransport((req: HttpRequest) => {
      if (req.url.includes('rupload_')) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ upload_id: 'V1', status: 'ok' }),
        };
      }
      count += 1;
      const out = configure();
      return { status: out.status, headers: {}, body: JSON.stringify(out.body) };
    });
    return {
      client: new PrivateClient({ transport, session: createSession() }),
      configures: () => count,
    };
  }
  const OPTIONS = { durationMs: 8000, width: 720, height: 1280 };

  it('retries configure while the server is still transcoding', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const { client, configures } = videoClient(() => {
        calls += 1;
        return calls < 3
          ? { status: 400, body: { status: 'fail', message: 'Transcode not finished yet.' } }
          : { status: 200, body: { status: 'ok', media: { pk: 1, code: 'vid' } } };
      });
      const pending = uploadVideo(client, new Uint8Array([1]), JPEG, OPTIONS);
      await vi.runAllTimersAsync();
      expect((await pending).code).toBe('vid');
      expect(configures()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a single override replace the value read from the file', async () => {
    const { client, transport } = (() => {
      const t = new FakeTransport((req: HttpRequest) =>
        req.url.includes('rupload_')
          ? { status: 200, headers: {}, body: JSON.stringify({ upload_id: 'V1', status: 'ok' }) }
          : { status: 200, headers: {}, body: JSON.stringify({ status: 'ok', media: { pk: 1 } }) },
      );
      return {
        client: new PrivateClient({ transport: t, session: createSession() }),
        transport: t,
      };
    })();

    await uploadVideo(client, sampleMp4(), JPEG, { durationMs: 12000 });

    const params = JSON.parse(
      transport.requests[0]?.headers['X-Instagram-Rupload-Params'] ?? '{}',
    ) as {
      upload_media_duration_ms: string;
      upload_media_width: string;
      upload_media_height: string;
    };
    expect(params.upload_media_duration_ms).toBe('12000');
    expect(params.upload_media_width).toBe('640');
    expect(params.upload_media_height).toBe('480');
  });

  it('does not repeat configure when Instagram says to wait', async () => {
    const { client, configures } = videoClient(() => ({
      status: 400,
      body: { status: 'fail', message: 'Please wait a few minutes before you try again.' },
    }));
    await expect(uploadVideo(client, new Uint8Array([1]), JPEG, OPTIONS)).rejects.toBeInstanceOf(
      PleaseWaitError,
    );
    expect(configures()).toBe(1);
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

describe('uploadAlbum', () => {
  const CONFIGURED = { status: 'ok', media: { pk: 1, code: 'alb', media_type: 8 } };

  /** Every rupload answers with the upload id it was sent, as the server does. */
  function albumClient(configure: (call: number) => { status: number; body: unknown }): {
    client: PrivateClient;
    transport: FakeTransport;
    configures: () => number;
  } {
    let configures = 0;
    const transport = new FakeTransport((req: HttpRequest) => {
      if (req.url.includes('rupload_')) {
        const params = JSON.parse(req.headers['X-Instagram-Rupload-Params'] ?? '{}') as {
          upload_id: string;
        };
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ upload_id: params.upload_id, status: 'ok' }),
        };
      }
      configures += 1;
      const answer = configure(configures);
      return { status: answer.status, headers: {}, body: JSON.stringify(answer.body) };
    });
    return {
      client: new PrivateClient({
        transport,
        session: createSession({ auth: { userId: '10000000001' } }),
      }),
      transport,
      configures: () => configures,
    };
  }

  const rParams = (request: HttpRequest | undefined): Record<string, string> =>
    JSON.parse(request?.headers['X-Instagram-Rupload-Params'] ?? '{}') as Record<string, string>;

  it('uploads each photo as part of an album, then publishes them together', async () => {
    const { client, transport } = albumClient(() => ({ status: 200, body: CONFIGURED }));

    const media = await uploadAlbum(client, [{ photo: JPEG }, { photo: JPEG }], { caption: 'two' });

    const [first, second, configure] = transport.requests;
    expect(first?.url).toContain('/rupload_igphoto/');
    expect(rParams(first)['is_sidecar']).toBe('1');
    expect(rParams(first)['media_type']).toBe('1');
    expect(rParams(first)['upload_id']).not.toBe(rParams(second)['upload_id']);

    expect(configure?.url).toBe('https://i.instagram.com/api/v1/media/configure_sidecar/');
    const body = signedPayload(configure?.body);
    expect(body['caption']).toBe('two');
    expect(body['_uid']).toBe('10000000001');
    expect(body['source_type']).toBe('4');
    const children = body['children_metadata'] as Record<string, unknown>[];
    expect(children).toHaveLength(2);
    expect(children.map((child) => child['upload_id'])).toEqual([
      rParams(first)['upload_id'],
      rParams(second)['upload_id'],
    ]);
    expect(JSON.parse(String(children[0]?.['edits']))).toEqual({
      crop_original_size: [400, 300],
      crop_center: [0, 0],
      crop_zoom: 1,
    });
    expect(JSON.parse(String(children[0]?.['extra']))).toEqual({
      source_width: 400,
      source_height: 300,
    });
    expect(media.code).toBe('alb');
  });

  it('uploads a video with its cover, marked as an album item', async () => {
    const { client, transport } = albumClient(() => ({ status: 200, body: CONFIGURED }));

    await uploadAlbum(client, [
      { photo: JPEG },
      { video: new Uint8Array([1, 2]), cover: JPEG, durationMs: 4000, width: 720, height: 1280 },
    ]);

    const video = transport.requests.find((request) => request.url.includes('rupload_igvideo'));
    expect(rParams(video)['is_sidecar']).toBe('1');
    expect(rParams(video)['upload_media_duration_ms']).toBe('4000');
    expect(video?.headers['Segment-Start-Offset']).toBe('0');
    expect(video?.headers['Segment-Type']).toBe('3');
    const cover = transport.requests.filter((request) =>
      request.url.includes('rupload_igphoto'),
    )[1];
    expect(rParams(cover)['media_type']).toBe('2');
    expect(rParams(cover)['upload_id']).toBe(rParams(video)['upload_id']);

    const configure = transport.requests.at(-1);
    const children = signedPayload(configure?.body)['children_metadata'] as Record<
      string,
      unknown
    >[];
    const child = children[1];
    expect(child?.['length']).toBe(4);
    expect(JSON.parse(String(child?.['clips']))).toEqual([{ length: 4, source_type: '4' }]);
    expect(child?.['poster_frame_index']).toBe('0');
    expect(child?.['date_time_original']).toMatch(/^\d{8}T\d{6}\.000Z$/);
  });

  it('refuses fewer than 2 or more than 10 items, before any request', async () => {
    const { client, transport } = albumClient(() => ({ status: 200, body: CONFIGURED }));
    await expect(uploadAlbum(client, [{ photo: JPEG }])).rejects.toBeInstanceOf(IgError);
    await expect(
      uploadAlbum(
        client,
        Array.from({ length: 11 }, () => ({ photo: JPEG })),
      ),
    ).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('checks every file before uploading the first one', async () => {
    const { client, transport } = albumClient(() => ({ status: 200, body: CONFIGURED }));
    await expect(
      uploadAlbum(client, [{ photo: JPEG }, { photo: new Uint8Array([1, 2, 3]) }]),
    ).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('retries configure while a video is still transcoding', async () => {
    vi.useFakeTimers();
    try {
      const { client, configures } = albumClient((call) =>
        call < 3
          ? { status: 400, body: { status: 'fail', message: 'Transcode not finished yet.' } }
          : { status: 200, body: CONFIGURED },
      );
      const pending = uploadAlbum(client, [
        { photo: JPEG },
        { video: new Uint8Array([1]), cover: JPEG, durationMs: 1000, width: 10, height: 10 },
      ]);
      await vi.runAllTimersAsync();
      expect((await pending).code).toBe('alb');
      expect(configures()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a throttling answer', async () => {
    const { client, configures } = albumClient(() => ({
      status: 400,
      body: { status: 'fail', message: 'Please wait a few minutes before you try again.' },
    }));
    await expect(uploadAlbum(client, [{ photo: JPEG }, { photo: JPEG }])).rejects.toBeInstanceOf(
      PleaseWaitError,
    );
    expect(configures()).toBe(1);
  });

  it('throws when the published media does not match the schema', async () => {
    const { client } = albumClient(() => ({ status: 200, body: { status: 'ok', media: 'x' } }));
    await expect(uploadAlbum(client, [{ photo: JPEG }, { photo: JPEG }])).rejects.toBeInstanceOf(
      ClientSchemaError,
    );
  });
});

describe('uploadReel', () => {
  const CONFIGURED = { status: 'ok', media: { pk: 1, code: 'rl', media_type: 2 } };

  /** The upload hosts answer ok; the configure call answers as the test says. */
  function reelClient(configure: (call: number) => { status: number; body: unknown }): {
    client: PrivateClient;
    transport: FakeTransport;
    configures: () => number;
  } {
    let configures = 0;
    const transport = new FakeTransport((req: HttpRequest) => {
      if (req.url.includes('rupload_igphoto')) {
        const params = JSON.parse(req.headers['X-Instagram-Rupload-Params'] ?? '{}') as {
          upload_id: string;
        };
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ upload_id: params.upload_id, status: 'ok' }),
        };
      }
      if (req.url.includes('rupload_igvideo') || req.url.includes('upload_settings')) {
        return { status: 200, headers: {}, body: JSON.stringify({ status: 'ok' }) };
      }
      configures += 1;
      const answer = configure(configures);
      return { status: answer.status, headers: {}, body: JSON.stringify(answer.body) };
    });
    return {
      client: new PrivateClient({
        transport,
        session: createSession({ auth: { userId: '10000000001' } }),
      }),
      transport,
      configures: () => configures,
    };
  }

  const signed = (request: HttpRequest | undefined): Record<string, unknown> =>
    signedPayload(request?.body);
  const META = { durationMs: 4500, width: 720, height: 1280 };
  const MP4 = new Uint8Array([1, 2, 3, 4, 5]);
  const rParams = (request: HttpRequest | undefined): Record<string, string> =>
    JSON.parse(request?.headers['X-Instagram-Rupload-Params'] ?? '{}') as Record<string, string>;

  it('sends the settings, the video and the cover, then configures it as a reel', async () => {
    const { client, transport } = reelClient(() => ({ status: 200, body: CONFIGURED }));

    const media = await uploadReel(client, MP4, JPEG, { ...META, caption: 'my reel' });

    const [settings, offset, video, cover, configure] = transport.requests;
    expect(settings?.url).toMatch(/^https:\/\/i\.instagram\.com\/upload_settings\/[0-9a-f-]{36}$/);
    expect(settings?.headers['X-Entity-Name']).toBe('upload_settings');
    expect(settings?.headers['Content-Type']).toBe('application/json');
    const sent = JSON.parse(new TextDecoder().decode(settings?.body as Uint8Array)) as {
      composer_session_id: string;
      upload_setting_properties: {
        video: Record<string, unknown>;
        context: Record<string, unknown>;
      };
    };
    expect(settings?.url.endsWith(sent.composer_session_id)).toBe(true);
    expect(sent.upload_setting_properties.video).toMatchObject({
      video_width: 720,
      video_height: 1280,
      video_duration_milliseconds: 4500,
      target_duration: 4,
      video_original_file_size: MP4.length,
    });
    expect(sent.upload_setting_properties.context).toMatchObject({
      source_type: 'clips',
      target_id: 10000000001,
    });

    expect(offset?.method).toBe('GET');
    expect(offset?.url).toMatch(/\/rupload_igvideo\/[0-9a-f]{32}-0-5-\d+-\d+$/);
    expect(video?.method).toBe('POST');
    expect(video?.url).toBe(offset?.url);
    expect(video?.body).toEqual(MP4);
    expect(video?.headers['X-Entity-Type']).toBe('video/mp4');
    expect(video?.headers['Segment-Type']).toBe('3');
    expect(video?.headers['Content-Length']).toBe(String(MP4.length));
    expect(video?.headers['X_FB_VIDEO_WATERFALL_ID']).toMatch(
      /^[0-9a-f-]{36}_[0-9A-F]{12}_Mixed_0$/,
    );
    const params = rParams(video);
    expect(params).toMatchObject({
      is_clips_video: '1',
      share_type: 'reels',
      media_type: '2',
      upload_media_duration_ms: '4500',
      upload_media_width: '720',
      upload_media_height: '1280',
    });

    expect(cover?.url).toContain('/rupload_igphoto/');
    expect(rParams(cover)['upload_id']).toBe(params['upload_id']);

    expect(configure?.url).toBe('https://i.instagram.com/api/v1/media/configure_to_clips/?video=1');
    const body = signed(configure);
    expect(body).toMatchObject({
      upload_id: params['upload_id'],
      caption: 'my reel',
      clips_share_preview_to_feed: '1',
      length: 4.5,
      capture_type: 'clips_v2',
      original_width: 720,
      original_height: 1280,
      _uid: '10000000001',
    });
    expect(body).toMatchObject({
      clips_segments_metadata: { num_segments: 1, clips_segments: [{ duration_ms: 4500 }] },
    });
    expect(media.code).toBe('rl');
  });

  it('can keep the preview out of the feed', async () => {
    const { client, transport } = reelClient(() => ({ status: 200, body: CONFIGURED }));
    await uploadReel(client, MP4, JPEG, { ...META, showInFeed: false });
    expect(signed(transport.requests.at(-1))).toMatchObject({ clips_share_preview_to_feed: '0' });
  });

  it('reads the size and length from the file when they are not given', async () => {
    const { client, transport } = reelClient(() => ({ status: 200, body: CONFIGURED }));
    const meta = parseMp4Meta(sampleMp4());
    await uploadReel(client, sampleMp4(), JPEG);
    expect(signed(transport.requests.at(-1))).toMatchObject({
      original_width: meta.width,
      original_height: meta.height,
      length: meta.durationMs / 1000,
    });
  });

  it('rejects a bad cover or a file that is not an MP4 before any request', async () => {
    const { client, transport } = reelClient(() => ({ status: 200, body: CONFIGURED }));
    await expect(uploadReel(client, MP4, new Uint8Array([1, 2, 3]), META)).rejects.toBeInstanceOf(
      IgError,
    );
    await expect(uploadReel(client, new Uint8Array([1, 2, 3]), JPEG)).rejects.toBeInstanceOf(
      IgError,
    );
    expect(transport.requests).toHaveLength(0);
  });

  it('retries configure while the server is still transcoding', async () => {
    vi.useFakeTimers();
    try {
      const { client, configures } = reelClient((call) =>
        call < 3
          ? { status: 400, body: { status: 'fail', message: 'Transcode not finished yet.' } }
          : { status: 200, body: CONFIGURED },
      );
      const pending = uploadReel(client, MP4, JPEG, META);
      await vi.runAllTimersAsync();
      expect((await pending).code).toBe('rl');
      expect(configures()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a throttling answer', async () => {
    const { client, configures } = reelClient(() => ({
      status: 400,
      body: { status: 'fail', message: 'Please wait a few minutes before you try again.' },
    }));
    await expect(uploadReel(client, MP4, JPEG, META)).rejects.toBeInstanceOf(PleaseWaitError);
    expect(configures()).toBe(1);
  });

  it('throws when the published media does not match the schema', async () => {
    const { client } = reelClient(() => ({ status: 200, body: { status: 'ok', media: 'x' } }));
    await expect(uploadReel(client, MP4, JPEG, META)).rejects.toBeInstanceOf(ClientSchemaError);
  });
});
