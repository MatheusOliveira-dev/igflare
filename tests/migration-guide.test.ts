import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as sdk from '../src/index';
import { FakeTransport } from '../src/core/transport/adapters/fake';

// The page names igflare calls in prose tables and code blocks that no compiler sees, so a
// rename in the facade would leave the guide pointing at methods that no longer exist.
const page = readFileSync(new URL('../website/guide/migrating.md', import.meta.url), 'utf8');

/** The igflare side of the page: `[igflare]` code blocks and the igflare column of tables. */
function igflareText(markdown: string): string {
  const blocks = [...markdown.matchAll(/```ts \[igflare\]\n([\s\S]*?)```/g)].map((m) => m[1]);
  const cells: string[] = [];
  let column = -1;
  for (const line of markdown.split('\n')) {
    if (!line.startsWith('|')) {
      column = -1;
      continue;
    }
    const row = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (column === -1) {
      column = row.indexOf('igflare');
      continue;
    }
    const cell = row[column];
    if (cell !== undefined && !/^-+$/.test(cell)) cells.push(cell);
  }
  return [...blocks, ...cells].join('\n');
}

const text = igflareText(page);
const calls = [...new Set([...text.matchAll(/\big\.(\w+)\.(\w+)\(/g)].map((m) => m[0]))];
const topLevel = [...new Set([...text.matchAll(/\big\.(\w+)\(/g)].map((m) => m[1] ?? ''))];
const errors = [...new Set([...text.matchAll(/`(\w+Error)`/g)].map((m) => m[1] ?? ''))];
const imports = [...text.matchAll(/import \{([^}]+)\} from 'igflare'/g)].flatMap((m) =>
  (m[1] ?? '').split(',').map((name) => name.trim()),
);

describe('migration guide', () => {
  // Nothing is sent: the test only reads the facade's shape.
  const transport = new FakeTransport(() => {
    throw new Error('unexpected request');
  });
  const ig = new sdk.IgFlare({ transport, retry: false });
  const facade = ig as unknown as Record<string, Record<string, unknown> | undefined>;

  it('finds the igflare side of the page', () => {
    expect(calls.length).toBeGreaterThan(80);
    expect(errors.length).toBeGreaterThan(10);
    expect(imports).toContain('IgFlare');
  });

  it.each(calls)('%s exists on the facade', (call) => {
    const [, namespace, method] = /ig\.(\w+)\.(\w+)\(/.exec(call) ?? [];
    expect(typeof facade[namespace ?? '']?.[method ?? '']).toBe('function');
  });

  it.each(topLevel)('ig.%s exists on the facade', (method) => {
    expect(typeof facade[method]).toBe('function');
  });

  it.each([...errors, ...imports])('%s is exported', (name) => {
    expect(name in sdk).toBe(true);
  });

  it('names only error classes that extend IgError', () => {
    const exports = sdk as unknown as Record<string, unknown>;
    for (const name of errors) {
      const value = exports[name];
      expect(typeof value === 'function' && value.prototype instanceof sdk.IgError).toBe(true);
    }
  });
});
