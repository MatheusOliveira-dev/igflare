# Publishing

Files go in as bytes, a `Buffer` or a `Uint8Array`.

```ts
import { readFile } from 'node:fs/promises';

const photo = await readFile('photo.jpg');
const clip = await readFile('clip.mp4');
const cover = await readFile('cover.jpg');
```

## Posts, carousels and reels

```ts
await ig.upload.photo(photo, { caption: 'Hello' });
await ig.upload.video(clip, cover, { caption: 'A short clip' });

await ig.upload.album(
  [{ photo }, { video: clip, cover }, { photo: await readFile('second.jpg') }],
  { caption: 'A carousel' },
);

await ig.upload.reel(clip, cover, { caption: 'A reel' });
```

Each returns the published post as a `Media`, with its `code` for the URL
(`https://www.instagram.com/p/<code>/`).

::: info Files
Photos and covers are JPEG. igflare reads their size from the file and does not convert
other formats. A video takes a separate cover, because igflare has no video decoder. The
duration and frame size are read from the MP4. Instagram may take a moment to process a
video, and the upload waits for it.
:::

## Stories

```ts
const story = await ig.upload.story(photo);
```

## Highlights

```ts
const highlight = await ig.highlight.create('Trips', [story.id]);
await ig.highlight.edit(highlight.id, { title: 'Trips 2026', addStoryIds: [otherStoryId] });
await ig.highlight.edit(highlight.id, { coverJpeg: cover });
await ig.highlight.delete(highlight.id); // the stories are kept
```

## Notes

The short text over the profile picture in the inbox, for a day:

```ts
const note = await ig.notes.create('Out for lunch', { audience: 'closeFriends' });
await ig.notes.list(); // own notes and those of followed accounts
await ig.notes.delete(note.note_id);
```

## Tags

```ts
await ig.media.edit(id, {
  caption: 'With friends',
  tag: [{ userId: '10000000001', x: 0.5, y: 0.4 }], // position as fractions of the photo
  untag: ['10000000002'],
});
```

A caption-only edit never touches the tags. On a private account Instagram only keeps a tag
for someone who can see the post, and answers ok for anyone else, so read `usertags` on the
result to confirm.

::: warning Published means public
Everything here is visible to the account's followers, and tags notify the people tagged.
:::
