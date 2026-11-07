import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SessionData, SessionStore } from '../session';
import { parseSessionData } from '../session';
import { IgError } from '../../../errors/ig-error';

/** Persists the session as a JSON file on disk. */
export class FileSessionStore implements SessionStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<SessionData | null> {
    let raw: string;
    try {
      raw = await readFile(this.#path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw new IgError(`Could not read session file: ${this.#path}`, { cause: error });
    }
    try {
      return parseSessionData(JSON.parse(raw) as unknown);
    } catch (error) {
      throw new IgError(`Session file is not valid: ${this.#path}`, { cause: error });
    }
  }

  async save(data: SessionData): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, JSON.stringify(data, null, 2), 'utf8');
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
