// Reads a profile, its latest posts and some of its followers from a saved session.
//
//   npx tsx examples/read.ts instagram
import { FileSessionStore, IgFlare } from 'igflare';

const username = process.argv[2] ?? 'instagram';
const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'));

const user = await ig.user.infoByUsername(username);
console.log(user.username, user.follower_count, 'followers');

// One page at a time, with the cursor for the next one.
const page = await ig.feed.user(String(user.pk));
for (const media of page.items) {
  console.log(media.code, media.like_count, 'likes');
}

// Or walk the list and break early. Each page is one request.
let count = 0;
for await (const follower of ig.friendship.paginateFollowers(String(user.pk))) {
  console.log('follower', follower.username);
  count += 1;
  if (count === 20) break;
}
