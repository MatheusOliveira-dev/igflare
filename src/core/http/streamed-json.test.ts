import { describe, it, expect } from 'vitest';
import { parseStreamedJson } from './streamed-json';
import { parsePrivateResponse } from './response';

const ROOT = '1$ig_post_insights(media_igid:$mediaIgid)';

const first = JSON.stringify({ data: { [ROOT]: { likes: 0 } }, extensions: { is_final: false } });
const second = JSON.stringify({
  label: 'Summary',
  path: ['ig_post_insights(media_igid:$mediaIgid)'],
  data: { total_views: 3 },
});

describe('parseStreamedJson', () => {
  it('merges each deferred fragment into the root field it names', () => {
    const merged = parseStreamedJson(`${first}\n      ${second}\n   `);
    expect(merged?.['data']).toEqual({ [ROOT]: { likes: 0, total_views: 3 } });
  });

  it('follows array positions in a path', () => {
    const body = [
      JSON.stringify({ data: { '1$list': { rows: [{ a: 1 }, { a: 2 }] } } }),
      JSON.stringify({ path: ['list', 'rows', 1], data: { b: 3 } }),
    ].join('\n');
    expect(parseStreamedJson(body)?.['data']).toEqual({
      '1$list': { rows: [{ a: 1 }, { a: 2, b: 3 }] },
    });
  });

  it('ignores a fragment whose path leads nowhere', () => {
    const body = [first, JSON.stringify({ path: ['missing'], data: { x: 1 } })].join('\n');
    expect(parseStreamedJson(body)?.['data']).toEqual({ [ROOT]: { likes: 0 } });
  });

  it('ignores a fragment with no data, no path or a path step of the wrong kind', () => {
    const body = [
      first,
      JSON.stringify({ label: 'x' }),
      JSON.stringify({ path: [true], data: { x: 1 } }),
      JSON.stringify({ path: [0], data: { x: 1 } }),
    ].join('\n');
    expect(parseStreamedJson(body)?.['data']).toEqual({ [ROOT]: { likes: 0 } });
  });

  it('keeps 64-bit ids exact', () => {
    const body = [
      JSON.stringify({ data: { '1$q': {} } }),
      '{"path":["q"],"data":{"id":4000000000000000001}}',
    ].join('\n');
    expect(parseStreamedJson(body)?.['data']).toEqual({ '1$q': { id: '4000000000000000001' } });
  });

  it('is undefined for a single line or for lines that are not objects', () => {
    expect(parseStreamedJson(first)).toBeUndefined();
    expect(parseStreamedJson(`${first}\n[1]`)).toBeUndefined();
  });

  it('is read by parsePrivateResponse in place of a plain document', () => {
    const json = parsePrivateResponse({ status: 200, headers: {}, body: `${first}\n${second}` });
    expect(json['data']).toEqual({ [ROOT]: { likes: 0, total_views: 3 } });
  });
});
