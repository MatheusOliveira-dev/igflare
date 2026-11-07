import { describe, it, expect } from 'vitest';
import { MemorySessionStore } from './memory';
import { createSession } from '../session';

describe('MemorySessionStore', () => {
  it('returns null when empty', async () => {
    expect(await new MemorySessionStore().load()).toBeNull();
  });

  it('saves and loads', async () => {
    const store = new MemorySessionStore();
    const session = createSession();
    await store.save(session);
    expect(await store.load()).toEqual(session);
  });

  it('accepts an initial value', async () => {
    const session = createSession();
    expect(await new MemorySessionStore(session).load()).toBe(session);
  });
});
