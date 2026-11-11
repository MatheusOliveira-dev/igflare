# Lists and pagination

Lists come in two forms: a call that returns one page, and an iterator that walks all
of them.

## One page at a time

```ts
const page = await ig.friendship.followers(pk);

page.items; // User[]
page.nextCursor; // a string, or undefined on the last page

const next = await ig.friendship.followers(pk, { cursor: page.nextCursor });
```

`cursor` is the same option on every list. It is opaque: it goes back as received, never
built or parsed.

## Every item

The `paginate...` iterator next to each list fetches pages on demand:

```ts
for await (const follower of ig.friendship.paginateFollowers(pk)) {
  console.log(follower.username);
}
```

Each page is one request, made only when the loop needs it. Breaking out stops the requests:

```ts
const first100 = [];
for await (const follower of ig.friendship.paginateFollowers(pk)) {
  first100.push(follower);
  if (first100.length === 100) break;
}
```

::: tip Pace long walks
Instagram limits how fast an account acts. Walking a list of a hundred thousand followers
in one go is the kind of thing that gets an account limited. A saved cursor resumes the
walk later.
:::

## Lists with iterators

| Page call                         | Iterator                                  |
| --------------------------------- | ----------------------------------------- |
| `ig.feed.user(pk)`                | `ig.feed.paginateUser(pk)`                |
| `ig.feed.timeline()`              | `ig.feed.paginateTimeline()`              |
| `ig.feed.hashtag(tag)`            | `ig.feed.paginateHashtag(tag)`            |
| `ig.feed.location(id)`            | `ig.feed.paginateLocation(id)`            |
| `ig.friendship.followers(pk)`     | `ig.friendship.paginateFollowers(pk)`     |
| `ig.friendship.following(pk)`     | `ig.friendship.paginateFollowing(pk)`     |
| `ig.friendship.pending()`         | `ig.friendship.paginatePending()`         |
| `ig.media.comments(id)`           | `ig.media.paginateComments(id)`           |
| `ig.media.replies(id, commentId)` | `ig.media.paginateReplies(id, commentId)` |
| `ig.media.saved()`                | `ig.media.paginateSaved()`                |
| `ig.collection.medias(id)`        | `ig.collection.paginateMedias(id)`        |
| `ig.reels.user(pk)`               | `ig.reels.paginateUser(pk)`               |
| `ig.explore.feed()`               | `ig.explore.paginateFeed()`               |
| `ig.direct.inbox()`               | `ig.direct.paginateInbox()`               |
| `ig.direct.thread(threadId)`      | `ig.direct.paginateThread(threadId)`      |
| `ig.insights.content(options)`    | `ig.insights.paginateContent(options)`    |
