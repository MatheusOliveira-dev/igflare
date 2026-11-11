// Read-only check against the live service: does everything still work for a logged-in
// account? Run it before a release and whenever Instagram seems to have changed.
//
//   npm run build
//   IGFLARE_SESSION=/path/to/session.json node scripts/live-check.mjs [--cycles 3]
//
// The session file is the one a `FileSessionStore` writes after a login. Use a test
// account. Nothing here writes, follows, likes or messages anyone, so nobody is notified.
// Output carries counts and timings only, never ids, names or tokens.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomInt } from 'node:crypto';

const sessionPath = process.env['IGFLARE_SESSION'];
if (sessionPath === undefined || sessionPath === '') {
  process.stderr.write('Set IGFLARE_SESSION to the path of a saved session file.\n');
  process.exit(2);
}

const cyclesFlag = process.argv.indexOf('--cycles');
const cycles = cyclesFlag >= 0 ? Number(process.argv[cyclesFlag + 1]) : 1;
if (!Number.isInteger(cycles) || cycles < 1) {
  process.stderr.write('--cycles takes a whole number of 1 or more.\n');
  process.exit(2);
}

const dist = pathToFileURL(resolve(import.meta.dirname, '../dist/index.mjs')).href;
const { IgFlare, FileSessionStore } = await import(dist);
const ig = await IgFlare.fromStore(new FileSessionStore(resolve(sessionPath)));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// A page of results that comes back "ok" but empty is how a drifted query shows up,
// so each check names what it expects to find.
const some = (list, what) => {
  if (!Array.isArray(list) || list.length === 0) throw new Error(`no ${what}`);
};
let sampleMediaId;

const checks = [
  [
    'account.me',
    async () => {
      const me = await ig.account.me();
      if (typeof me['username'] !== 'string') throw new Error('no username');
    },
  ],
  [
    'account.activity',
    async () => {
      await ig.account.activity();
    },
  ],
  [
    'account.links',
    async () => {
      await ig.account.links();
    },
  ],
  [
    'user.infoByUsername',
    async () => {
      const user = await ig.user.infoByUsername('instagram');
      if (user.username !== 'instagram') throw new Error('wrong user');
    },
  ],
  ['search.users', async () => some(await ig.search.users('instagram'), 'users')],
  ['search.hashtags', async () => some(await ig.search.hashtags('instagram'), 'hashtags')],
  [
    'feed.hashtag',
    async () => {
      const page = await ig.feed.hashtag('instagram');
      some(page.items, 'hashtag posts');
      sampleMediaId = page.items[0]?.pk;
    },
  ],
  [
    'media.info',
    async () => {
      if (sampleMediaId === undefined) throw new Error('needs feed.hashtag first');
      const media = await ig.media.info(sampleMediaId);
      if (media.pk === undefined) throw new Error('no media');
    },
  ],
  ['feed.timeline', async () => some((await ig.feed.timeline()).items, 'timeline posts')],
  [
    'feed.user',
    async () => {
      const me = await ig.account.me();
      await ig.feed.user(String(me['pk']));
    },
  ],
  [
    'direct.inbox',
    async () => {
      await ig.direct.inbox();
    },
  ],
  [
    'story.tray',
    async () => {
      await ig.story.tray();
    },
  ],
];

const stats = new Map();
for (let cycle = 1; cycle <= cycles; cycle += 1) {
  for (const [name, run] of checks) {
    const started = Date.now();
    let outcome = 'ok';
    try {
      await run();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      outcome = `FAIL ${error?.constructor?.name ?? 'Error'}: ${text.slice(0, 90)}`;
    }
    const entry = stats.get(name) ?? { ok: 0, fail: 0, ms: 0, last: '' };
    entry.ms += Date.now() - started;
    if (outcome === 'ok') entry.ok += 1;
    else {
      entry.fail += 1;
      entry.last = outcome;
    }
    stats.set(name, entry);
    process.stdout.write(`cycle ${String(cycle)} ${name.padEnd(22)} ${outcome}\n`);
    // Pace the calls: this is a check, not a load test.
    await sleep(cycles === 1 ? 2500 : randomInt(20000, 40000));
  }
}

let failed = false;
process.stdout.write('\n=== summary ===\n');
for (const [name, entry] of stats) {
  const calls = entry.ok + entry.fail;
  failed ||= entry.fail > 0;
  const tail = entry.fail > 0 ? `  <- ${entry.last}` : '';
  process.stdout.write(
    `${name.padEnd(22)} ok=${String(entry.ok)} fail=${String(entry.fail)} avg=${String(Math.round(entry.ms / calls))}ms${tail}\n`,
  );
}
process.exit(failed ? 1 : 0);
