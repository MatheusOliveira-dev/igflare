import { isRecord } from '../guards';
import { parseLosslessJson } from './lossless-json';

/**
 * Some persisted queries answer in several JSON documents, one per line: the first holds
 * `data`, each later one holds `label`, `path` and a `data` fragment for a part the server
 * deferred. The fragments are padded with blanks, so lines are trimmed before parsing.
 */
function mergeFragment(root: Record<string, unknown>, fragment: Record<string, unknown>): void {
  const data = fragment['data'];
  const path = fragment['path'];
  const base = root['data'];
  if (!isRecord(data) || !Array.isArray(path) || !isRecord(base)) {
    return;
  }
  let node: unknown = base;
  for (const step of path as unknown[]) {
    if (!isRecord(node) && !Array.isArray(node)) {
      return;
    }
    if (isRecord(node) && typeof step === 'string') {
      // The first document keys a root field as `1$name(...)`; a path names it without the prefix.
      const key = Object.keys(node).find((name) => name === step || name === `1$${step}`);
      node = key !== undefined ? node[key] : undefined;
    } else if (Array.isArray(node) && typeof step === 'number') {
      node = (node as unknown[])[step];
    } else {
      return;
    }
  }
  if (isRecord(node)) {
    Object.assign(node, data);
  }
}

/**
 * Parses a response made of one JSON document per line into a single document, with every
 * deferred fragment merged into `data`. Returns `undefined` when the body is not that shape.
 */
export function parseStreamedJson(body: string): Record<string, unknown> | undefined {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length < 2) {
    return undefined;
  }
  let root: Record<string, unknown> | undefined;
  for (const line of lines) {
    const parsed: unknown = parseLosslessJson(line);
    if (!isRecord(parsed)) {
      return undefined;
    }
    if (root === undefined) {
      root = parsed;
    } else {
      mergeFragment(root, parsed);
    }
  }
  return root;
}
