/**
 * The shape every paginated list endpoint returns: one page of items plus the
 * cursor for the next page. `nextMaxId` is absent on the last page. This is the
 * low-level primitive; callers that want to walk the whole list opt into the
 * `paginate` iterator rather than looping the cursor by hand.
 */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextMaxId?: string;
}

/**
 * Walks every page of a cursor-paginated endpoint, yielding items one by one.
 * `fetchPage` takes the cursor (undefined for the first page) and returns a
 * `Page`; iteration stops when a page has no `nextMaxId`.
 */
export async function* paginate<T>(
  fetchPage: (maxId?: string) => Promise<Page<T>>,
): AsyncGenerator<T> {
  let maxId: string | undefined;
  do {
    const page = await fetchPage(maxId);
    for (const item of page.items) {
      yield item;
    }
    maxId = page.nextMaxId;
  } while (maxId !== undefined && maxId !== '');
}
