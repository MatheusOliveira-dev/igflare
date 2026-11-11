import { describe, it, expect } from 'vitest';
import {
  getMediaInfo,
  likeMedia,
  unlikeMedia,
  commentMedia,
  deleteComment,
  deleteMedia,
  getComments,
  getLikers,
  paginateComments,
  saveMedia,
  unsaveMedia,
  getSavedPosts,
} from './media';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';

/** Recovers the JSON payload from a signed_body form request. */
function signedPayload(body: string | Uint8Array | undefined): Record<string, unknown> {
  const form = new URLSearchParams(typeof body === 'string' ? body : '');
  const signed = form.get('signed_body') ?? '';
  return JSON.parse(signed.slice(signed.indexOf('.') + 1)) as Record<string, unknown>;
}

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

describe('media actions', () => {
  it('likes a media, posting media_id in the signed body', async () => {
    const { client, transport } = clientReturning({ status: 'ok' });

    await expect(likeMedia(client, '1_9')).resolves.toBeUndefined();
    expect(transport.requests[0]?.url).toBe('https://i.instagram.com/api/v1/media/1_9/like/');
    expect(transport.requests[0]?.method).toBe('POST');
    expect(signedPayload(transport.requests[0]?.body)['media_id']).toBe('1_9');
  });

  it('unlikes a media against the unlike endpoint', async () => {
    const { client, transport } = clientReturning({ status: 'ok' });
    await unlikeMedia(client, '1_9');
    expect(transport.requests[0]?.url).toContain('/api/v1/media/1_9/unlike/');
  });

  it('comments on a media and returns the created comment', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      comment: { pk: 77, text: 'nice', user: { pk: 2, username: 'me' } },
    });

    const comment = await commentMedia(client, '1_9', 'nice');

    expect(comment.pk).toBe('77');
    expect(comment.text).toBe('nice');
    expect(transport.requests[0]?.url).toContain('/api/v1/media/1_9/comment/');
    const payload = signedPayload(transport.requests[0]?.body);
    expect(payload['comment_text']).toBe('nice');
    expect(payload['idempotence_token']).toMatch(/[0-9a-f-]{36}/);
  });

  it('throws a typed schema error when the comment has the wrong shape', async () => {
    const { client } = clientReturning({ status: 'ok', comment: { pk: 1, text: 42 } });
    await expect(commentMedia(client, '1_9', 'x')).rejects.toBeInstanceOf(ClientSchemaError);
  });

  it('deletes a comment by id against the delete endpoint', async () => {
    const { client, transport } = clientReturning({ status: 'ok' });
    await deleteComment(client, '1_9', '77');
    expect(transport.requests[0]?.url).toContain('/api/v1/media/1_9/comment/77/delete/');
  });

  it('deletes a media with its type in the query', async () => {
    const { client, transport } = clientReturning({ status: 'ok', did_delete: true });
    await deleteMedia(client, '1_9', 'PHOTO');
    expect(transport.requests[0]?.url).toContain('/api/v1/media/1_9/delete/?media_type=PHOTO');
    expect(signedPayload(transport.requests[0]?.body)['media_id']).toBe('1_9');
  });
});

describe('media comments and likers', () => {
  it('lists comments with the min_id cursor', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      comments: [{ pk: 1, text: 'nice', user: { pk: 2, username: 'a' } }],
      next_min_id: 'm1',
    });

    const page = await getComments(client, '1_9');

    expect(transport.requests[0]?.url).toContain('/api/v1/media/1_9/comments/');
    expect(page.items[0]?.text).toBe('nice');
    expect(page.nextCursor).toBe('m1');
  });

  it('passes the cursor as min_id on later pages', async () => {
    const { client, transport } = clientReturning({ status: 'ok', comments: [] });
    await getComments(client, '1_9', { cursor: 'm1' });
    expect(transport.requests[0]?.url).toContain('?min_id=m1');
  });

  it('lists the likers of a media', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      users: [{ pk: 1, username: 'a' }],
    });

    const users = await getLikers(client, '1_9');

    expect(transport.requests[0]?.url).toContain('/api/v1/media/1_9/likers/');
    expect(users[0]?.username).toBe('a');
  });
});

describe('comment iterator', () => {
  it('walks comments across pages', async () => {
    let call = 0;
    const transport = new FakeTransport(() => {
      call += 1;
      const body =
        call === 1
          ? { status: 'ok', comments: [{ pk: 1, text: 'a' }], next_min_id: 'm2' }
          : { status: 'ok', comments: [{ pk: 2, text: 'b' }] };
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    });
    const client = new PrivateClient({ transport, session: createSession() });

    const texts: (string | undefined)[] = [];
    for await (const comment of paginateComments(client, '1_9')) {
      texts.push(comment.text);
    }
    expect(texts).toEqual(['a', 'b']);
  });
});

describe('saved', () => {
  it('saves and unsaves a media', async () => {
    const a = clientReturning({ status: 'ok' });
    await saveMedia(a.client, '1_9');
    expect(a.transport.requests[0]?.url).toContain('/api/v1/media/1_9/save/');

    const b = clientReturning({ status: 'ok' });
    await unsaveMedia(b.client, '1_9');
    expect(b.transport.requests[0]?.url).toContain('/api/v1/media/1_9/unsave/');
  });

  it('saves into, and removes from, one collection', async () => {
    const save = clientReturning({ status: 'ok' });
    await saveMedia(save.client, '1_9', { collectionId: '17900000000000001' });
    expect(signedPayload(save.transport.requests[0]?.body)['added_collection_ids']).toBe(
      '[17900000000000001]',
    );

    const unsave = clientReturning({ status: 'ok' });
    await unsaveMedia(unsave.client, '1_9', { collectionId: '5' });
    expect(unsave.transport.requests[0]?.url).toContain('/api/v1/media/1_9/unsave/');
    expect(signedPayload(unsave.transport.requests[0]?.body)['added_collection_ids']).toBe('[5]');
  });

  it('sends no collection ids when saving to the general list', async () => {
    const { client, transport } = clientReturning({ status: 'ok' });
    await saveMedia(client, '1_9');
    expect(signedPayload(transport.requests[0]?.body)).not.toHaveProperty('added_collection_ids');
  });

  it('refuses a collection id that is not numeric, before any request', async () => {
    const { client, transport } = clientReturning({ status: 'ok' });
    await expect(saveMedia(client, '1_9', { collectionId: '5,6' })).rejects.toThrow(
      'A collection id must be a numeric id',
    );
    expect(transport.requests).toHaveLength(0);
  });

  it('lists saved posts, unwrapping each item media', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      items: [{ media: { pk: 1, code: 'a' } }],
      next_max_id: 's2',
      more_available: true,
    });

    const page = await getSavedPosts(client);

    expect(transport.requests[0]?.url).toContain('/api/v1/feed/saved/posts/');
    expect(page.items[0]?.code).toBe('a');
    expect(page.nextCursor).toBe('s2');
  });
});
