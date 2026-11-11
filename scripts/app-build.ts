// Compares the persisted GraphQL queries in manifest/persisted-queries.json with the ones
// an app build ships, so moving to a new build is a reviewed diff instead of a guess.
//
//   npm run app-build -- path/to/base.apk [--build 455.0.0.12.34] [--write]
//
// The APK carries `assets/ig4a-instagram-schema_client_persist_ids.json`, which maps each
// operation name to its persisted-query id. Without `--write` this only reports. With it,
// the changed ids are written to the manifest (and `--build` records the build they came
// from); run `npm run gen` and `npm run live-check` afterwards. A query that the build no
// longer ships is reported and left as it is: it needs a look at the APK, not a rename.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const PERSIST_IDS_ENTRY = 'assets/ig4a-instagram-schema_client_persist_ids.json';
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
/** The end record sits in the last 22 bytes plus a comment of at most 64 KiB. */
const END_SEARCH_WINDOW = 22 + 0xffff;

export interface ManifestQuery {
  readonly name: string;
  readonly operation: string;
  readonly docId: string;
  readonly pinned?: boolean;
  readonly note?: string;
}

export interface PersistedManifest {
  readonly version: number;
  readonly appBuild: string;
  readonly queries: readonly ManifestQuery[];
}

export interface BuildReport {
  readonly unchanged: readonly string[];
  readonly changed: readonly {
    readonly name: string;
    readonly from: string;
    readonly to: string;
  }[];
  readonly missing: readonly string[];
  readonly pinned: readonly string[];
}

/** Where the end of central directory record starts, searching back from the end. */
function findEndRecord(zip: Buffer): number {
  const searchFrom = Math.max(0, zip.length - END_SEARCH_WINDOW);
  for (let at = zip.length - 22; at >= searchFrom; at -= 1) {
    if (zip.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      return at;
    }
  }
  throw new Error('not a ZIP file (no end of central directory)');
}

/** The uncompressed bytes of the entry whose central record starts at `at`. */
function entryData(zip: Buffer, at: number, entryName: string): Buffer {
  const method = zip.readUInt16LE(at + 10);
  const compressedSize = zip.readUInt32LE(at + 20);
  const localHeader = zip.readUInt32LE(at + 42);
  if (zip.readUInt32LE(localHeader) !== LOCAL_FILE_HEADER) {
    throw new Error(`broken ZIP local header for ${entryName}`);
  }
  // The local header has its own name and extra lengths, which can differ from the central ones.
  const dataStart =
    localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
  const data = zip.subarray(dataStart, dataStart + compressedSize);
  if (method === STORED) {
    return Buffer.from(data);
  }
  if (method === DEFLATED) {
    return inflateRawSync(data);
  }
  throw new Error(`unsupported ZIP compression method ${String(method)} for ${entryName}`);
}

/** Reads one file out of a ZIP archive (an APK is one), without any dependency. */
export function readZipEntry(zip: Buffer, entryName: string): Buffer {
  const end = findEndRecord(zip);
  const entries = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < entries; index += 1) {
    if (zip.readUInt32LE(at) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error('broken ZIP central directory');
    }
    const nameLength = zip.readUInt16LE(at + 28);
    if (zip.toString('utf8', at + 46, at + 46 + nameLength) === entryName) {
      return entryData(zip, at, entryName);
    }
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  throw new Error(`${entryName} is not in the archive`);
}

/** The operation name to persisted-query id map of the build's asset. */
export function parsePersistIds(json: string): Map<string, string> {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('the persist ids asset is not a JSON object');
  }
  const ids = new Map<string, string>();
  for (const [operation, entry] of Object.entries(parsed)) {
    const docId: unknown =
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)['client_doc_id']
        : undefined;
    if (typeof docId === 'string' && /^\d+$/.test(docId)) {
      ids.set(operation, docId);
    }
  }
  return ids;
}

/** How each query of the manifest fares against a build's ids. */
export function compareBuild(manifest: PersistedManifest, ids: Map<string, string>): BuildReport {
  const unchanged: string[] = [];
  const changed: { name: string; from: string; to: string }[] = [];
  const missing: string[] = [];
  const pinned: string[] = [];
  for (const query of manifest.queries) {
    if (query.pinned === true) {
      pinned.push(query.name);
      continue;
    }
    const docId = ids.get(query.operation);
    if (docId === undefined) {
      missing.push(query.name);
    } else if (docId === query.docId) {
      unchanged.push(query.name);
    } else {
      changed.push({ name: query.name, from: query.docId, to: docId });
    }
  }
  return { unchanged, changed, missing, pinned };
}

/** The manifest with the changed ids applied and, when given, the new build recorded. */
export function applyReport(
  manifest: PersistedManifest,
  report: BuildReport,
  appBuild?: string,
): PersistedManifest {
  const updates = new Map(report.changed.map((change) => [change.name, change.to]));
  return {
    ...manifest,
    appBuild: appBuild ?? manifest.appBuild,
    queries: manifest.queries.map((query) => {
      const docId = updates.get(query.name);
      return docId !== undefined ? { ...query, docId } : query;
    }),
  };
}

function main(argv: readonly string[]): number {
  const args = argv.filter((arg) => !arg.startsWith('--'));
  const buildFlag = argv.indexOf('--build');
  const appBuild = buildFlag >= 0 ? argv[buildFlag + 1] : undefined;
  const apk = args.find((arg) => arg !== appBuild);
  if (apk === undefined) {
    process.stderr.write(
      'usage: npm run app-build -- path/to/base.apk [--build x.y.z] [--write]\n',
    );
    return 2;
  }
  if (appBuild !== undefined && !/^\d+(\.\d+)+$/.test(appBuild)) {
    process.stderr.write('--build takes a version like 455.0.0.12.34\n');
    return 2;
  }
  const manifestPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'manifest',
    'persisted-queries.json',
  );
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PersistedManifest;
  const ids = parsePersistIds(
    readZipEntry(readFileSync(resolve(apk)), PERSIST_IDS_ENTRY).toString('utf8'),
  );
  const report = compareBuild(manifest, ids);

  process.stdout.write(`the build ships ${String(ids.size)} persisted queries\n`);
  process.stdout.write(`unchanged: ${report.unchanged.join(', ') || 'none'}\n`);
  for (const change of report.changed) {
    process.stdout.write(`changed:   ${change.name} ${change.from} -> ${change.to}\n`);
  }
  for (const name of report.missing) {
    process.stdout.write(`missing:   ${name} (the build does not ship it; check the APK)\n`);
  }
  if (report.pinned.length > 0) {
    process.stdout.write(`pinned:    ${report.pinned.join(', ')} (kept as they are)\n`);
  }

  if (argv.includes('--write')) {
    const updated = applyReport(manifest, report, appBuild);
    writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
    process.stdout.write('manifest written; now run npm run gen and npm run live-check\n');
  }
  return report.missing.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
