import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  applyReport,
  compareBuild,
  parsePersistIds,
  readZipEntry,
  type PersistedManifest,
} from '../scripts/app-build';

interface Entry {
  readonly name: string;
  readonly data: Buffer;
  readonly deflate: boolean;
}

/** A minimal ZIP: local headers, then the central directory, then the end record. */
function zip(entries: readonly Entry[], comment = ''): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const body = entry.deflate ? deflateRawSync(entry.data) : entry.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, directory, end, Buffer.from(comment)]);
}

const ASSET = 'assets/ig4a-instagram-schema_client_persist_ids.json';

const MANIFEST: PersistedManifest = {
  version: 1,
  appBuild: '454.0.0.54.77',
  queries: [
    { name: 'topSerp', operation: 'TopSerpQuery', docId: '111' },
    { name: 'inboxTray', operation: 'InboxTrayRequest', docId: '222' },
    { name: 'gone', operation: 'GoneQuery', docId: '333' },
    { name: 'kept', operation: 'OldName', docId: '444', pinned: true },
  ],
};

describe('readZipEntry', () => {
  it('reads a deflated entry and a stored one, past an archive comment', () => {
    const archive = zip(
      [
        { name: 'classes.dex', data: Buffer.from('dex'), deflate: false },
        { name: ASSET, data: Buffer.from('{"a":1}'), deflate: true },
      ],
      'signed',
    );
    expect(readZipEntry(archive, ASSET).toString()).toBe('{"a":1}');
    expect(readZipEntry(archive, 'classes.dex').toString()).toBe('dex');
  });

  it('says which part is wrong', () => {
    const archive = zip([{ name: 'a', data: Buffer.from('x'), deflate: false }]);
    expect(() => readZipEntry(archive, ASSET)).toThrow(`${ASSET} is not in the archive`);
    expect(() => readZipEntry(Buffer.alloc(40), ASSET)).toThrow('not a ZIP file');
    const broken = Buffer.from(archive);
    broken.writeUInt32LE(0, broken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
    expect(() => readZipEntry(broken, 'a')).toThrow('broken ZIP central directory');
    const badLocal = Buffer.from(archive);
    badLocal.writeUInt32LE(0, 0);
    expect(() => readZipEntry(badLocal, 'a')).toThrow('broken ZIP local header');
    const odd = Buffer.from(archive);
    odd.writeUInt16LE(12, odd.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
    expect(() => readZipEntry(odd, 'a')).toThrow('unsupported ZIP compression method 12');
  });
});

describe('parsePersistIds', () => {
  it('maps each operation to its id and skips entries without a numeric one', () => {
    const ids = parsePersistIds(
      JSON.stringify({
        TopSerpQuery: { operation_name: 'TopSerpQuery', client_doc_id: '999' },
        Broken: { client_doc_id: 'abc' },
        Empty: null,
      }),
    );
    expect([...ids]).toEqual([['TopSerpQuery', '999']]);
    expect(() => parsePersistIds('[1]')).not.toThrow();
    expect(() => parsePersistIds('null')).toThrow('not a JSON object');
  });
});

describe('compareBuild and applyReport', () => {
  const ids = new Map([
    ['TopSerpQuery', '111'],
    ['InboxTrayRequest', '555'],
  ]);

  it('sorts the queries into unchanged, changed, missing and pinned', () => {
    expect(compareBuild(MANIFEST, ids)).toEqual({
      unchanged: ['topSerp'],
      changed: [{ name: 'inboxTray', from: '222', to: '555' }],
      missing: ['gone'],
      pinned: ['kept'],
    });
  });

  it('writes only the changed ids, and the build when one is given', () => {
    const report = compareBuild(MANIFEST, ids);
    const updated = applyReport(MANIFEST, report, '455.0.0.1.2');
    expect(updated.appBuild).toBe('455.0.0.1.2');
    expect(updated.queries.map((query) => query.docId)).toEqual(['111', '555', '333', '444']);
    expect(applyReport(MANIFEST, report).appBuild).toBe('454.0.0.54.77');
  });
});
