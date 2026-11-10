import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';

const endpointsDir = dirname(fileURLToPath(import.meta.url));

/** Every non-test source file under src/endpoints, as { relativePath, text }. */
function endpointSources(): { file: string; text: string }[] {
  return readdirSync(endpointsDir, { recursive: true })
    .map(String)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .map((file) => ({ file, text: readFileSync(join(endpointsDir, file), 'utf8') }));
}

const sources = endpointSources();

// The machine half of the response/error contract in ARCHITECTURE.md. It catches
// the two drifts a static check can catch for sure; honest nullability and that a
// returned model is actually schema-validated stay with the reviewer.
describe('endpoint response/error contract', () => {
  it('scans at least the known endpoint files', () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it.each(sources.map((s) => s.file))('%s returns no error envelope (throws instead)', (file) => {
    const text = sources.find((s) => s.file === file)?.text ?? '';
    // An endpoint signals failure by throwing a typed error, never by returning
    // an { ok } / { success } envelope.
    expect(text).not.toMatch(/return\s*\{[^}]*\b(?:ok|success)\b\s*:/);
  });

  it.each(sources.map((s) => s.file))('%s resolves its path from the registry', (file) => {
    const text = sources.find((s) => s.file === file)?.text ?? '';
    // A quoted/backtick value right after `endpoint:` that holds a path segment is
    // an inline literal. Registry use is an expression (no quote) or a template
    // that interpolates `endpoints.*` (contains `${`); rawUrl hosts carry no slash.
    const values = [...text.matchAll(/endpoint:\s*[`'"]([^`'"]*)/g)].map((m) => m[1] ?? '');
    const inlinePaths = values.filter((v) => !v.includes('${') && v.includes('/'));
    expect(inlinePaths).toEqual([]);
  });
});
