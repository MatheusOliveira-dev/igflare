// Flags marketing filler in prose and comments. Plain technical English only.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const banned = [
  'seamless',
  'seamlessly',
  'robust',
  'powerful',
  'comprehensive',
  'effortless',
  'effortlessly',
  'leverage',
  'utilize',
  'delve',
  'boasts',
  'elevate',
  'cutting-edge',
  'game-changer',
  'game changer',
  'in today',
  "it's worth noting",
  'needless to say',
  'unleash',
  'supercharge',
];

const pattern = new RegExp(
  `\\b(${banned.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
);

function trackedFiles() {
  const out = execSync('git ls-files "*.md" "src/**/*.ts" "scripts/**/*.mjs"', {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

let found = false;
for (const file of trackedFiles()) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    const m = pattern.exec(line);
    if (m) {
      found = true;
      process.stdout.write(`${file}:${String(i + 1)}: marketing filler "${m[1]}"\n`);
    }
  });
}

if (found) {
  process.stdout.write('\nRewrite the flagged lines in plain technical English.\n');
  process.exit(1);
}
process.stdout.write('prose ok\n');
