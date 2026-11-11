/**
 * The shape every paginated list endpoint returns: one page of items plus the
 * cursor for the next page. `nextCursor` is absent on the last page. This is the
 * low-level primitive. Callers that want to walk the whole list opt into the
 * `paginate` iterator rather than looping the cursor by hand.
 */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

/**
 * Walks every page of a cursor-paginated endpoint, yielding items one by one.
 * `fetchPage` takes the cursor (undefined for the first page) and returns a
 * `Page`. Iteration stops when a page has no `nextCursor`.
 */
export async function* paginate<T>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
): AsyncGenerator<T> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const item of page.items) {
      yield item;
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined && cursor !== '');
}
