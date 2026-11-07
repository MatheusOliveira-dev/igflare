import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { FileSessionStore } from './file';
import { IgError } from '../../../errors/ig-error';
import { createSession } from '../session';

const dir = join(tmpdir(), `ig-sdk-${randomUUID()}`);
const path = join(dir, 'session.json');

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileSessionStore', () => {
  it('returns null when the file does not exist', async () => {
    expect(await new FileSessionStore(path).load()).toBeNull();
  });

  it('round-trips a saved session', async () => {
    const store = new FileSessionStore(path);
    const session = createSession({ auth: { userId: '9', authorization: 'Bearer x' } });
    await store.save(session);
    expect(await store.load()).toEqual(session);
  });

  it('throws a typed error on invalid json', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path, 'not json', 'utf8');
    await expect(new FileSessionStore(path).load()).rejects.toBeInstanceOf(IgError);
  });

  it('throws a typed error when the path cannot be read', async () => {
    await mkdir(dir, { recursive: true });
    await expect(new FileSessionStore(dir).load()).rejects.toBeInstanceOf(IgError);
  });
});
