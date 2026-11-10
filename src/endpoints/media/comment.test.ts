import { describe, it, expect } from 'vitest';
import {
  likeComment,
  unlikeComment,
  pinComment,
  unpinComment,
  deleteComments,
  getCommentReplies,
  paginateCommentReplies,
} from './comment';
import { commentMedia } from './media';
import { PrivateClient } from '../../core/http/private-client';
import { FakeTransport } from '../../core/transport/adapters/fake';
import type { HttpRequest } from '../../core/transport/http-transport';
import { createSession } from '../../core/session/session';
import { ClientSchemaError } from '../../errors/api-errors';
import { IgError } from '../../errors/ig-error';

const COMMENT = '18123628009908217'; // 17 digits: more than a JS number holds exactly
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

const OK = { status: 'ok' };

describe('comment likes', () => {
  it('likes and unlikes a comment through its own id in the path', async () => {
    const a = clientReturning(OK);
    await likeComment(a.client, COMMENT);
    expect(a.transport.requests[0]?.url).toContain(`/api/v1/media/${COMMENT}/comment_like/`);
    expect(a.transport.requests[0]?.method).toBe('POST');
    expect(signedPayload(a.transport.requests[0])['container_module']).toBe(
      'feed_contextual_self_profile',
    );

    const b = clientReturning(OK);
    await unlikeComment(b.client, COMMENT);
    expect(b.transport.requests[0]?.url).toContain(`/media/${COMMENT}/comment_unlike/`);
  });
});

describe('comment pins', () => {
  it('pins and unpins a comment of a media', async () => {
    const a = clientReturning(OK);
    await pinComment(a.client, MEDIA, COMMENT);
    expect(a.transport.requests[0]?.url).toContain(`/media/${MEDIA}/pin_comment/${COMMENT}/`);

    const b = clientReturning(OK);
    await unpinComment(b.client, MEDIA, COMMENT);
    expect(b.transport.requests[0]?.url).toContain(`/media/${MEDIA}/unpin_comment/${COMMENT}/`);
  });
});

describe('deleteComments', () => {
  it('deletes several comments as a comma-separated list', async () => {
    const { client, transport } = clientReturning(OK);
    await deleteComments(client, MEDIA, [COMMENT, '18123628009908218']);
    expect(transport.requests[0]?.url).toContain(`/media/${MEDIA}/comment/bulk_delete/`);
    expect(signedPayload(transport.requests[0])['comment_ids_to_delete']).toBe(
      `${COMMENT},18123628009908218`,
    );
  });
});

describe('replies', () => {
  it('replies to a comment by sending replied_to_comment_id as an exact string', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      comment: { pk: 2, text: 'ok', user: { pk: 1, username: 'me' } },
    });

    const reply = await commentMedia(client, MEDIA, 'ok', { repliedToCommentId: COMMENT });

    expect(reply.text).toBe('ok');
    expect(signedPayload(transport.requests[0])['replied_to_comment_id']).toBe(COMMENT);
  });

  it('does not send replied_to_comment_id for a top-level comment', async () => {
    const { client, transport } = clientReturning({ status: 'ok', comment: { pk: 2 } });
    await commentMedia(client, MEDIA, 'hi');
    expect(signedPayload(transport.requests[0])).not.toHaveProperty('replied_to_comment_id');
  });

  it('lists the replies with the child cursor', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      child_comments: [{ pk: 5, text: 'r1' }],
      has_more_head_child_comments: true,
      next_min_child_cursor: 'c2',
    });

    const page = await getCommentReplies(client, MEDIA, COMMENT);

    expect(transport.requests[0]?.url).toContain(
      `/media/${MEDIA}/comments/${COMMENT}/inline_child_comments/`,
    );
    expect(page.items[0]?.text).toBe('r1');
    expect(page.nextCursor).toBe('c2');
  });

  it('passes the cursor as min_id and stops when there are no more replies', async () => {
    const { client, transport } = clientReturning({
      status: 'ok',
      child_comments: [],
      has_more_head_child_comments: false,
      next_min_child_cursor: 'ignored',
    });
    const page = await getCommentReplies(client, MEDIA, COMMENT, { cursor: 'c2' });
    expect(transport.requests[0]?.url).toContain('?min_id=c2');
    expect(page.nextCursor).toBeUndefined();
  });

  it('walks every reply across pages', async () => {
    let call = 0;
    const transport = new FakeTransport(() => {
      call += 1;
      const body =
        call === 1
          ? {
              status: 'ok',
              child_comments: [{ pk: 1, text: 'a' }],
              has_more_head_child_comments: true,
              next_min_child_cursor: 'p2',
            }
          : { status: 'ok', child_comments: [{ pk: 2, text: 'b' }] };
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    });
    const client = new PrivateClient({ transport, session: createSession() });

    const texts: (string | undefined)[] = [];
    for await (const reply of paginateCommentReplies(client, MEDIA, COMMENT)) {
      texts.push(reply.text);
    }
    expect(texts).toEqual(['a', 'b']);
  });

  it('throws a typed error when a reply has the wrong shape', async () => {
    const { client } = clientReturning({ status: 'ok', child_comments: [{ pk: 1, text: 42 }] });
    await expect(getCommentReplies(client, MEDIA, COMMENT)).rejects.toBeInstanceOf(
      ClientSchemaError,
    );
  });
});

describe('id validation', () => {
  it('rejects ids that are not numeric before any request', async () => {
    const { client, transport } = clientReturning(OK);
    await expect(likeComment(client, '../evil')).rejects.toBeInstanceOf(IgError);
    await expect(pinComment(client, 'abc', COMMENT)).rejects.toBeInstanceOf(IgError);
    await expect(deleteComments(client, MEDIA, [])).rejects.toBeInstanceOf(IgError);
    expect(transport.requests).toHaveLength(0);
  });
});
