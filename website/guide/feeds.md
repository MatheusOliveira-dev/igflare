# Feeds and posts

## Feeds

```ts
await ig.feed.timeline(); // the home feed
await ig.feed.user(pk); // a user's posts
await ig.feed.hashtag('travel'); // posts for a hashtag, ranked by relevance
await ig.feed.location(locationId); // recent posts at a place

await ig.reels.user(pk);
await ig.reels.feed(); // the reels tab
await ig.reels.explore(); // reels suggested in Explore
await ig.reels.friends(); // reels friends interacted with

await ig.explore.feed();
```

Each has an iterator, such as `ig.feed.paginateTimeline()`. See
[Lists and pagination](./pagination).

::: info Hashtag feeds
The hashtag feed is the app's search results for `#tag`, ranked by relevance. There is no
chronological view, and each post is the light form the results grid uses.
`ig.media.info(id)` returns the caption and counts.
:::

## Stories and highlights

```ts
const tray = await ig.story.tray(); // accounts with active stories, in the app's order
const stories = await ig.story.user(pk);
await ig.story.markSeen(stories.map((story) => String(story.id)));

await ig.highlight.list(pk);
await ig.highlight.info('highlight:17900000000000001');
```

## A post

```ts
const post = await ig.media.info(id);

await ig.media.like(id);
await ig.media.unlike(id);
await ig.media.likers(id);

const comment = await ig.media.comment(id, 'Nice one');
await ig.media.comment(id, 'Thanks!', { repliedToCommentId: comment.pk });
await ig.media.comments(id);
await ig.media.replies(id, commentId);
await ig.media.likeComment(commentId);
await ig.media.pinComment(id, commentId); // on the account's own post
await ig.media.deleteComment(id, commentId);
await ig.media.deleteComments(id, [commentId, otherId]);
```

## Saving

```ts
await ig.media.save(id);
await ig.media.saved(); // saved posts

const recipes = await ig.collection.create('Recipes');
await ig.media.save(id, { collectionId: recipes.collection_id });
await ig.collection.list();
await ig.collection.medias(recipes.collection_id);
await ig.collection.liked(); // liked posts
await ig.collection.delete(recipes.collection_id);
```

## Own posts

```ts
await ig.media.edit(id, { caption: 'New caption' });
await ig.media.archive(id); // hidden from the profile, kept in the archive
await ig.media.unarchive(id);
await ig.media.pin(id); // to the top of the grid
await ig.media.unpin(id);
await ig.media.delete(id);
```

To publish, see [Publishing](./publishing).
