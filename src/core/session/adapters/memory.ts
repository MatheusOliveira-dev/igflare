import type { SessionData, SessionStore } from '../session';

/** Keeps the session in memory. Useful for tests and short-lived processes. */
export class MemorySessionStore implements SessionStore {
  #data: SessionData | null;

  constructor(initial: SessionData | null = null) {
    this.#data = initial;
  }

  load(): Promise<SessionData | null> {
    return Promise.resolve(this.#data);
  }

  save(data: SessionData): Promise<void> {
    this.#data = data;
    return Promise.resolve();
  }
}
