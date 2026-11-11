import { describe, it, expect } from 'vitest';
import { getExploreFeed, paginateExploreFeed } from './explore';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function clientWith(handler: (req: HttpRequest) => HttpResponse): {
  client: PrivateClient;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(handler);
  return { client: new PrivateClient({ transport, session: createSession() }), transport };
}

const post = (pk: string, code: string): unknown => ({ pk, code, media_type: 1 });

/** Sections laid out as the app does: each layout hides its posts somewhere different. */
const SECTIONS = [
  { layout_type: 'full_width', layout_content: { full_item: { media: post('1', 'a') } } },
  {
    layout_type: 'dynamic_grid',
    layout_content: { medias: [{ media: post('2', 'b') }, { media: post('3', 'c') }] },
  },
  {
    layout_type: 'two_by_one_right',
    layout_content: {
      fill_items: [{ media: post('4', 'd') }],
      one_by_two_item: { clips: { items: [{ media: post('5', 'e') }] } },
    },
  },
  { layout_type: 'ad', layout_content: { ad_unit: { title: 'not a post' } } },
];

describe('getExploreFeed', () => {
  it('reads the posts from every layout of the sections', async () => {
    const { client, transport } = clientWith(() =>
      json({
        status: 'ok',
        sectional_items: SECTIONS,
        next_max_id: 'n2',
        max_id: 'n2',
        more_available: true,
      }),
    );

    const page = await getExploreFeed(client);

    const request = transport.requests[0];
    expect(request?.url).toBe('https://i.instagram.com/api/v1/discover/topical_explore/');
    expect(request?.method).toBe('GET');
    expect(page.items.map((item) => item.code)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(page.nextCursor).toBe('n2');
  });

  it('sends the cursor as max_id', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', sectional_items: [] }));
    await getExploreFeed(client, { cursor: 'n2' });
    expect(transport.requests[0]?.url).toContain('max_id=n2');
  });

  it('has no next cursor on the last page or without one', async () => {
    const last = clientWith(() =>
      json({ status: 'ok', sectional_items: [], next_max_id: 'x', more_available: false }),
    );
    expect((await getExploreFeed(last.client)).nextCursor).toBeUndefined();
    const none = clientWith(() => json({ status: 'ok', sectional_items: [] }));
    expect((await getExploreFeed(none.client)).nextCursor).toBeUndefined();
  });

  it('is empty for sections that hold no posts', async () => {
    const { client } = clientWith(() =>
      json({ status: 'ok', sectional_items: [{ layout_type: 'x', layout_content: {} }] }),
    );
    expect((await getExploreFeed(client)).items).toEqual([]);
  });

  it('does not search deeper than the layouts can nest', async () => {
    let deep: unknown = { media: post('9', 'z') };
    for (let level = 0; level < 12; level += 1) deep = { child: deep };
    const { client } = clientWith(() => json({ status: 'ok', sectional_items: [deep] }));
    expect((await getExploreFeed(client)).items).toEqual([]);
  });

  it('throws when the answer has no sections, or a post does not match the schema', async () => {
    const empty = clientWith(() => json({ status: 'ok' }));
    await expect(getExploreFeed(empty.client)).rejects.toBeInstanceOf(ClientSchemaError);
    const bad = clientWith(() =>
      json({
        status: 'ok',
        sectional_items: [
          { layout_content: { full_item: { media: { code: 'a', media_type: 'x' } } } },
        ],
      }),
    );
    await expect(getExploreFeed(bad.client)).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('walks every page with the iterator', async () => {
    let call = 0;
    const { client } = clientWith(() => {
      call += 1;
      return call === 1
        ? json({
            status: 'ok',
            sectional_items: [{ layout_content: { full_item: { media: post('1', 'a') } } }],
            next_max_id: 'n',
            more_available: true,
          })
        : json({
            status: 'ok',
            sectional_items: [{ layout_content: { full_item: { media: post('2', 'b') } } }],
            more_available: false,
          });
    });
    const codes: (string | undefined)[] = [];
    for await (const media of paginateExploreFeed(client)) codes.push(media.code);
    expect(codes).toEqual(['a', 'b']);
  });
});
