// Publishes a JPEG as a post, then a story. Both are visible to the account's followers.
//
//   npx tsx examples/post.ts photo.jpg "A caption"
import { readFileSync } from 'node:fs';
import { FileSessionStore, IgFlare } from 'igflare';

const [file = 'photo.jpg', caption = ''] = process.argv.slice(2);
const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'));
const jpeg = new Uint8Array(readFileSync(file));

const post = await ig.upload.photo(jpeg, { caption });
console.log('posted', `https://www.instagram.com/p/${String(post.code)}/`);

const story = await ig.upload.story(jpeg);
console.log('story', story.pk);
