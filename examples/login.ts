// Logs in once and saves the session, so the other examples (and any other code) reuse it.
//
//   IG_USERNAME=... IG_PASSWORD=... npx tsx examples/login.ts
//
// When Instagram asks for a code (a second factor or a login challenge), it is read from
// the terminal at the moment the code screen opens, which is when Instagram sends it.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { FileSessionStore, IgFlare } from 'igflare';

const username = process.env['IG_USERNAME'] ?? '';
const password = process.env['IG_PASSWORD'] ?? '';

async function ask(question: string): Promise<string> {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    return (await terminal.question(question)).trim();
  } finally {
    terminal.close();
  }
}

const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'));
if (ig.session.auth.userId === undefined) {
  await ig.login({ username, password, twoFactor: { provider: () => ask('Code: ') } });
}
const me = await ig.account.me();
console.log('logged in as', me['username']);
