import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_DEVICE_PROFILE } from '../src/core/transport/device';

// The README tells readers which app build was last checked live. A bump of the reported
// build without a new live check would leave that claim pointing at the wrong build.
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  .replace(/\n>\s*/g, ' ')
  .replace(/\s+/g, ' ');

describe('README verification note', () => {
  it('names the app build the client reports', () => {
    const note =
      /Last verified against the live service on \d{4}-\d{2}-\d{2}, as Instagram for Android ([\d.]+)\./.exec(
        readme,
      );
    expect(note?.[1]).toBe(DEFAULT_DEVICE_PROFILE.appVersion);
  });
});
