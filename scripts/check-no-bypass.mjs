// Fails if source sneaks in a way to bypass the guards. Config changes are the
// honest path. Silent inline escapes are not.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const forbidden = [
  { re: /\b(?:describe|it|test)\.only\s*\(/, msg: 'focused test (.only)' },
  { re: /@ts-nocheck/, msg: '@ts-nocheck' },
  { re: /@ts-ignore/, msg: '@ts-ignore (use @ts-expect-error with a reason)' },
  { re: /eslint-disable/, msg: 'inline eslint-disable (change the config instead)' },
];

const files = execSync('git ls-files "src/**/*.ts"', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.startsWith('src/generated/'));

let found = false;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of forbidden) {
      if (rule.re.test(line)) {
        found = true;
        process.stdout.write(`${file}:${String(i + 1)}: ${rule.msg}\n`);
      }
    }
  });
}

if (found) {
  process.stdout.write('\nRemove the bypass or change the shared config.\n');
  process.exit(1);
}
process.stdout.write('guard ok\n');
