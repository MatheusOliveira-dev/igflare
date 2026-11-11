// Sends a direct message to a user by username. The recipient is notified.
//
//   npx tsx examples/direct.ts someone "Hello"
import { FileSessionStore, IgFlare } from 'igflare';

const [username = '', text = 'Hello'] = process.argv.slice(2);
const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'));

const user = await ig.user.infoByUsername(username);
const sent = await ig.direct.sendText(text, { userIds: [String(user.pk)] });
console.log('sent in thread', sent.thread_id);

// The reply arrives in the same thread.
if (sent.thread_id !== undefined) {
  const messages = await ig.direct.thread(sent.thread_id);
  console.log(messages.items.length, 'messages in the thread');
}
