// Sends every request through an HTTP proxy.
//
//   PROXY_URL=http://user:password@host:8080 npx tsx examples/proxy.ts
import { FileSessionStore, IgFlare } from 'igflare';

const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'), {
  proxy: process.env['PROXY_URL'] ?? 'http://127.0.0.1:8080',
});
const me = await ig.account.me();
console.log('reached Instagram through the proxy as', me['username']);
