import { describe, it, expect } from 'vitest';
import {
  createCollection,
  deleteCollection,
  getCollectionMedias,
  getLikedMedias,
  listCollections,
  paginateCollectionMedias,
  paginateLikedMedias,
} from './collection';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest, HttpResponse } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

function json(body: unknown): HttpResponse {
  return { status: 200, headers: {}, body: JSON.stringify(body) };
}

function clientWith(handler: (req: HttpRequest) => HttpResponse): {
  client: PrivateClient;
  transport: FakeTransport;
} {
  const transport = new FakeTransport(handler);
  const session = createSession({ auth: { userId: '10000000001' } });
  return { client: new PrivateClient({ transport, session }), transport };
}

function signed(request: HttpRequest | undefined): Record<string, unknown> {
  const form = new URLSearchParams(typeof request?.body === 'string' ? request.body : '');
  const value = form.get('signed_body') ?? '';
  return JSON.parse(value.slice(value.indexOf('.') + 1)) as Record<string, unknown>;
}

const COLLECTION = {
  collection_id: '17900000000000001',
  collection_name: 'Trips',
  collection_type: 'MEDIA',
  collection_media_count: 3,
};

describe('listCollections', () => {
  it('asks for the automatic and personal collections', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', items: [COLLECTION] }));

    const collections = await listCollections(client);

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v1/collections/list/');
    expect(request?.method).toBe('GET');
    expect(request?.url).toContain('ALL_MEDIA_AUTO_COLLECTION');
    expect(collections).toHaveLength(1);
    expect(collections[0]?.collection_id).toBe('17900000000000001');
    expect(collections[0]?.collection_name).toBe('Trips');
  });

  it('follows the pages until the server says there are no more', async () => {
    let call = 0;
    const { client, transport } = clientWith(() => {
      call += 1;
      return call === 1
        ? json({ status: 'ok', items: [COLLECTION], more_available: true, next_max_id: 'p2' })
        : json({
            status: 'ok',
            items: [{ ...COLLECTION, collection_id: '2' }],
            more_available: false,
          });
    });

    const collections = await listCollections(client);

    expect(collections.map((item) => item.collection_id)).toEqual(['17900000000000001', '2']);
    expect(transport.requests[1]?.url).toContain('max_id=p2');
  });

  it('stops when the server claims more but gives no cursor', async () => {
    const { client, transport } = clientWith(() =>
      json({ status: 'ok', items: [COLLECTION], more_available: true }),
    );
    await listCollections(client);
    expect(transport.requests).toHaveLength(1);
  });

  it('throws when an entry has no id', async () => {
    const { client } = clientWith(() => json({ status: 'ok', items: [{ collection_name: 'x' }] }));
    await expect(listCollections(client)).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('getCollectionMedias', () => {
  it('reads the posts of one collection, unwrapping each item media', async () => {
    const { client, transport } = clientWith(() =>
      json({
        status: 'ok',
        items: [{ media: { pk: 1, code: 'a' } }, { pk: 2, code: 'b' }],
        next_max_id: 'm2',
        more_available: true,
      }),
    );

    const page = await getCollectionMedias(client, '17900000000000001');

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v1/feed/collection/17900000000000001/');
    expect(request?.url).toContain('include_igtv_preview=false');
    expect(page.items.map((item) => item.code)).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('m2');
  });

  it('sends the cursor as max_id and has no next cursor on the last page', async () => {
    const { client, transport } = clientWith(() =>
      json({ status: 'ok', items: [], next_max_id: 'x', more_available: false }),
    );
    const page = await getCollectionMedias(client, '5', { cursor: 'm2' });
    expect(transport.requests[0]?.url).toContain('max_id=m2');
    expect(page.nextCursor).toBeUndefined();
  });

  it('refuses an id that is not numeric, before any request', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', items: [] }));
    await expect(getCollectionMedias(client, '1/../x')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when the response has no items list', async () => {
    const { client } = clientWith(() => json({ status: 'ok' }));
    await expect(getCollectionMedias(client, '5')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('throws when a media does not match the schema', async () => {
    const { client } = clientWith(() =>
      json({ status: 'ok', items: [{ media: { pk: 1, media_type: 'photo' } }] }),
    );
    await expect(getCollectionMedias(client, '5')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('walks every page with the iterator', async () => {
    let call = 0;
    const { client } = clientWith(() => {
      call += 1;
      return call === 1
        ? json({
            status: 'ok',
            items: [{ media: { pk: 1 } }],
            next_max_id: 'n',
            more_available: true,
          })
        : json({ status: 'ok', items: [{ media: { pk: 2 } }], more_available: false });
    });
    const ids: (string | undefined)[] = [];
    for await (const media of paginateCollectionMedias(client, '5')) ids.push(media.pk);
    expect(ids).toEqual(['1', '2']);
  });
});

describe('getLikedMedias', () => {
  it('reads the posts the account has liked', async () => {
    const { client, transport } = clientWith(() =>
      json({
        status: 'ok',
        items: [{ pk: 7, code: 'l' }],
        next_max_id: 'l2',
        more_available: true,
      }),
    );

    const page = await getLikedMedias(client, { cursor: 'l1' });

    expect(transport.requests[0]?.url).toContain('/api/v1/feed/liked/');
    expect(transport.requests[0]?.url).toContain('max_id=l1');
    expect(page.items[0]?.code).toBe('l');
    expect(page.nextCursor).toBe('l2');
  });

  it('walks every page with the iterator', async () => {
    let call = 0;
    const { client } = clientWith(() => {
      call += 1;
      return call === 1
        ? json({ status: 'ok', items: [{ pk: 1 }], next_max_id: 'n', more_available: true })
        : json({ status: 'ok', items: [{ pk: 2 }], more_available: false });
    });
    const ids: (string | undefined)[] = [];
    for await (const media of paginateLikedMedias(client)) ids.push(media.pk);
    expect(ids).toEqual(['1', '2']);
  });
});

describe('createCollection', () => {
  it('creates a collection with the name and the posts it starts with', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', ...COLLECTION }));

    const collection = await createCollection(client, '  Trips ', ['4000000000000000001', '2']);

    const request = transport.requests[0];
    expect(request?.url).toContain('/api/v1/collections/create/');
    expect(request?.method).toBe('POST');
    const body = signed(request);
    expect(body['name']).toBe('Trips');
    expect(body['module_name']).toBe('collection_create');
    expect(body['collection_visibility']).toBe('0');
    // 19-digit ids stay exact in the list, not rounded through a number.
    expect(body['added_media_ids']).toBe('[4000000000000000001,2]');
    expect(collection.collection_id).toBe('17900000000000001');
  });

  it('starts empty when no posts are given', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', ...COLLECTION }));
    await createCollection(client, 'Empty');
    expect(signed(transport.requests[0])['added_media_ids']).toBe('[]');
  });

  it('refuses an empty name or a post id that is not numeric, before any request', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok', ...COLLECTION }));
    await expect(createCollection(client, '   ')).rejects.toBeInstanceOf(IgError);
    await expect(createCollection(client, 'x', ['1_2'])).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });

  it('throws when the answer has no collection id', async () => {
    const { client } = clientWith(() => json({ status: 'ok' }));
    await expect(createCollection(client, 'x')).rejects.toBeInstanceOf(ClientSchemaError);
  });
});

describe('deleteCollection', () => {
  it('deletes the collection by its id', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok' }));
    await deleteCollection(client, '17900000000000001');
    expect(transport.requests[0]?.url).toContain('/api/v1/collections/17900000000000001/delete/');
    expect(transport.requests[0]?.method).toBe('POST');
  });

  it('refuses an id that is not numeric, before any request', async () => {
    const { client, transport } = clientWith(() => json({ status: 'ok' }));
    await expect(deleteCollection(client, '5/../x')).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });
});
