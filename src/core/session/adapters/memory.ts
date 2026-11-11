import type { SessionData, SessionStore } from '../session';

/** Keeps the session in memory. Useful for tests and short-lived processes. */
export class MemorySessionStore implements SessionStore {
  #data: SessionData | null;

  constructor(initial: SessionData | null = null) {
    this.#data = initial;
  }

  /** The saved session, or `null` when nothing was saved. */
  load(): Promise<SessionData | null> {
    return Promise.resolve(this.#data);
  }

  /** Keeps the session in memory. */
  save(data: SessionData): Promise<void> {
    this.#data = data;
    return Promise.resolve();
  }
}
