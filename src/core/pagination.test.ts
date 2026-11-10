import { describe, it, expect } from 'vitest';
import { paginate, type Page } from './pagination';

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) {
    out.push(item);
  }
  return out;
}

describe('paginate', () => {
  it('walks every page until a page has no nextCursor', async () => {
    const pages: Record<string, Page<number>> = {
      __first: { items: [1, 2], nextCursor: 'a' },
      a: { items: [3, 4], nextCursor: 'b' },
      b: { items: [5] },
    };
    const seen: (string | undefined)[] = [];

    const all = await collect(
      paginate((maxId) => {
        seen.push(maxId);
        return Promise.resolve(pages[maxId ?? '__first'] ?? { items: [] });
      }),
    );

    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([undefined, 'a', 'b']);
  });

  it('stops on an empty-string cursor without a further fetch', async () => {
    let calls = 0;
    const all = await collect(
      paginate(() => {
        calls += 1;
        return Promise.resolve({ items: [1], nextCursor: '' });
      }),
    );
    expect(all).toEqual([1]);
    expect(calls).toBe(1);
  });
});
