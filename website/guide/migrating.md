# Migrating from instagram-private-api

This page maps the calls of [instagram-private-api](https://github.com/dilame/instagram-private-api)
(`IgApiClient`) to igflare. Both packages talk to the same private API of the Instagram app.
The request flows, models and errors differ, and the sections below cover each of them.

The old calls were checked against instagram-private-api 1.46.1, the latest release on npm.

## What changes

- **One object from a store.** `IgFlare.fromStore` loads the saved session and saves it
  after every request that changes it. There is no `generateDevice` call and no
  `request.end$` subscription.
- **Saved sessions do not carry over.** A state serialized by instagram-private-api cannot
  be loaded. The first run logs in once, from a new device, and Instagram may ask for a
  code. See [Logging in](./authentication).
- **Plain arguments.** Calls take ids as strings and positional arguments: no `moduleInfo`,
  no `d` flag, no options object for a single value.
- **Checked models.** Each call returns the model, checked at runtime, instead of the raw
  body. See [Results and errors](./errors).
- **Lists are pages or iterators.** A page call takes a cursor and returns `nextCursor`. An
  iterator walks every page. Feed objects with `items()` and `isMoreAvailable()` are gone.
- **One error class per failure.** The Instagram answer is in `error.payload.raw`, the
  status in `error.statusCode`.
- **Node 22 or newer.** ESM and CommonJS builds with type declarations, and `zod` is the
  only runtime dependency.

## Setup and session

::: code-group

```ts [instagram-private-api]
import { IgApiClient } from 'instagram-private-api';

const ig = new IgApiClient();
ig.state.generateDevice(username);

if (await exists('./state.json')) {
  await ig.state.deserialize(await readFile('./state.json', 'utf8'));
}

ig.request.end$.subscribe(async () => {
  const state = await ig.state.serialize();
  delete state.constants;
  await writeFile('./state.json', JSON.stringify(state));
});
```

:::

::: code-group

```ts [igflare]
import { IgFlare, FileSessionStore } from 'igflare';

// Loads the saved session, or starts a new device when there is none.
const store = new FileSessionStore('./session.json');
const ig = await IgFlare.fromStore(store);
```

:::

Any other storage is a two-method `SessionStore`. See [Sessions](./sessions).

## Logging in

::: code-group

```ts [instagram-private-api]
await ig.account.login(username, password);
```

:::

::: code-group

```ts [igflare]
if (ig.session.auth.userId === undefined) {
  await ig.login({ username, password });
}
```

:::

`login` goes through the flow of the current app build. The account id of the session is
in `ig.session.auth.userId`.

### Two-factor codes

::: code-group

```ts [instagram-private-api]
import { IgLoginTwoFactorRequiredError } from 'instagram-private-api';

try {
  await ig.account.login(username, password);
} catch (error) {
  if (!(error instanceof IgLoginTwoFactorRequiredError)) throw error;
  const info = error.response.body.two_factor_info;
  await ig.account.twoFactorLogin({
    username,
    verificationCode: await askUser('Code: '),
    twoFactorIdentifier: info.two_factor_identifier,
    verificationMethod: info.totp_two_factor_on ? '0' : '1',
  });
}
```

:::

::: code-group

```ts [igflare]
// Asked for once the code screen opens, when the code is sent.
await ig.login({
  username,
  password,
  twoFactor: { provider: () => askUser('Code: ') },
});

// Or computed from the authenticator secret.
await ig.login({
  username,
  password,
  twoFactor: { totpSecret: 'ABCD EFGH IJKL MNOP' },
});
```

:::

The channel is the one Instagram picks for the account, so there is no
`verificationMethod` to pass. Without `twoFactor`, `login` throws `CaaTwoFactorRequiredError`, and
`ig.resolveTwoFactor(error, code)` finishes it.

### Checkpoints

::: code-group

```ts [instagram-private-api]
import { IgCheckpointError } from 'instagram-private-api';

try {
  await ig.account.login(username, password);
} catch (error) {
  if (!(error instanceof IgCheckpointError)) throw error;
  await ig.challenge.auto(true);
  await ig.challenge.sendSecurityCode(await askUser('Code: '));
}
```

:::

::: code-group

```ts [igflare]
// The same source answers the code sent to the account's email.
await ig.login({
  username,
  password,
  twoFactor: { provider: () => askUser('Code: ') },
});
```

:::

A verification the flow cannot answer throws `ChallengeRequiredError`.

## Proxy

::: code-group

```ts [instagram-private-api]
ig.state.proxyUrl = 'http://user:password@proxy.example:8080';
```

:::

::: code-group

```ts [igflare]
const ig = await IgFlare.fromStore(store, {
  proxy: 'http://user:password@proxy.example:8080',
});
```

:::

HTTP and HTTPS proxies are built in. SOCKS goes through a custom `transport` instead of
`ig.request.defaults.agentClass`. See [Proxies, retries and transports](./network).

## Lists and pagination

::: code-group

```ts [instagram-private-api]
const feed = ig.feed.accountFollowers(userId);
const firstPage = await feed.items();

if (feed.isMoreAvailable()) {
  const secondPage = await feed.items();
}

const saved = feed.serialize();
feed.deserialize(saved);
```

:::

::: code-group

```ts [igflare]
const page = await ig.friendship.followers(userId);
page.items; // User[]

const next = await ig.friendship.followers(userId, {
  cursor: page.nextCursor,
});

for await (const follower of ig.friendship.paginateFollowers(userId)) {
  // pages load on demand; break stops the requests
}
```

:::

`nextCursor` replaces `serialize()`: a saved cursor resumes the list later. It is
`undefined` on the last page. See [Lists and pagination](./pagination).

## Errors

::: code-group

```ts [instagram-private-api]
import { IgResponseError } from 'instagram-private-api';

try {
  await ig.friendship.create(userId);
} catch (error) {
  if (error instanceof IgResponseError) {
    console.log(error.response.statusCode, error.response.body.message);
  }
}
```

:::

::: code-group

```ts [igflare]
import { IgApiError } from 'igflare';

try {
  await ig.friendship.follow(userId);
} catch (error) {
  if (error instanceof IgApiError) {
    console.log(error.statusCode, error.payload.message);
  }
}
```

:::

::: warning Same name, different class
Both packages export an `IgResponseError`. In igflare it is only the base of `IgApiError`
and carries no response body. A catch block written for the old class belongs on
`IgApiError`.
:::

| instagram-private-api           | igflare                                          |
| ------------------------------- | ------------------------------------------------ |
| `IgLoginBadPasswordError`       | `BadPasswordError`                               |
| `IgLoginTwoFactorRequiredError` | `CaaTwoFactorRequiredError`                      |
| `IgChallengeWrongCodeError`     | `InvalidVerificationCodeError`                   |
| `IgCheckpointError`             | `ChallengeRequiredError`                         |
| `IgLoginRequiredError`          | `LoginRequiredError`                             |
| `IgUserHasLoggedOutError`       | `LoginRequiredError`                             |
| `IgActionSpamError`             | `FeedbackRequiredError`                          |
| `IgSentryBlockError`            | `SentryBlockError`                               |
| `IgRequestsLimitError`          | `RateLimitError`                                 |
| `IgNotFoundError`               | `IgApiError` with `statusCode` 404               |
| `IgPrivateUserError`            | `IgApiError`, or `ClientForbiddenError` on a 403 |
| `IgInactiveUserError`           | `IgApiError`                                     |
| `IgResponseError`               | `IgApiError`                                     |
| `IgParseError`                  | `ClientJsonError`                                |
| `IgNetworkError`                | The network error, after the retries             |
| No equivalent                   | `ClientSchemaError`, an answer that drifts       |

Every class on the right extends `IgApiError` except `ClientJsonError`, `ClientSchemaError`
and the network error, so one `IgApiError` check covers every refused request. Suspended
accounts throw `AccountSuspendedError`, and "Please wait a few minutes" throws
`PleaseWaitError`. Connection errors, 429, 502, 503 and 504 are retried with backoff before
anything is thrown.

## Call map

Ids are strings in every igflare call. A post id is `pk_authorid`, the same form
instagram-private-api uses.

### Account

| instagram-private-api                      | igflare                         |
| ------------------------------------------ | ------------------------------- |
| `ig.account.currentUser()`                 | `ig.account.me()`               |
| `ig.account.setBiography(text)`            | `ig.account.setBiography(text)` |
| `ig.account.editProfile({ first_name })`   | `ig.account.setName(name)`      |
| `ig.account.editProfile({ external_url })` | `ig.account.setLink(url)`       |
| `ig.account.changeProfilePicture(buffer)`  | `ig.account.setPicture(jpeg)`   |
| `ig.account.removeProfilePicture()`        | `ig.account.removePicture()`    |
| `ig.news.inbox()`, `ig.feed.news()`        | `ig.account.activity()`         |

### Users and search

| instagram-private-api               | igflare                                       |
| ----------------------------------- | --------------------------------------------- |
| `ig.user.info(userId)`              | `ig.user.info(userId)`                        |
| `ig.user.usernameinfo(username)`    | `ig.user.infoByUsername(username)`            |
| `ig.user.searchExact(username)`     | `ig.user.infoByUsername(username)`            |
| `ig.user.getIdByUsername(username)` | `(await ig.user.infoByUsername(username)).pk` |
| `ig.user.search(query)`             | `ig.search.users(query)`                      |
| `ig.search.users(query)`            | `ig.search.users(query)`                      |
| `ig.search.tags(query)`             | `ig.search.hashtags(query)`                   |
| `ig.search.places(query)`           | `ig.search.places(query)`                     |
| `ig.search.location(lat, lng)`      | `ig.location.nearby(lat, lng)`                |
| `ig.location.info(id)`              | `ig.location.info(id)`                        |

### Follow graph

| instagram-private-api                                 | igflare                                            |
| ----------------------------------------------------- | -------------------------------------------------- |
| `ig.friendship.show(userId)`                          | `ig.friendship.status(userId)`                     |
| `ig.friendship.create(userId)`                        | `ig.friendship.follow(userId)`                     |
| `ig.friendship.destroy(userId)`                       | `ig.friendship.unfollow(userId)`                   |
| `ig.friendship.approve(userId)`                       | `ig.friendship.approve(userId)`                    |
| `ig.friendship.deny(userId)`                          | `ig.friendship.deny(userId)`                       |
| `ig.friendship.removeFollower(userId)`                | `ig.friendship.removeFollower(userId)`             |
| `ig.friendship.block(userId)`                         | `ig.friendship.block(userId)`                      |
| `ig.friendship.unblock(userId)`                       | `ig.friendship.unblock(userId)`                    |
| `ig.friendship.setBesties({ add })`                   | `ig.friendship.addCloseFriend(userId)`             |
| `ig.friendship.setBesties({ remove })`                | `ig.friendship.removeCloseFriend(userId)`          |
| `ig.friendship.mutePostsOrStoryFromFollow(options)`   | `ig.friendship.mute(userId, { posts, stories })`   |
| `ig.friendship.unmutePostsOrStoryFromFollow(options)` | `ig.friendship.unmute(userId, { posts, stories })` |
| `ig.feed.accountFollowers(userId)`                    | `ig.friendship.followers(userId)`                  |
| `ig.feed.accountFollowing(userId)`                    | `ig.friendship.following(userId)`                  |
| `ig.feed.pendingFriendships()`                        | `ig.friendship.pending()`                          |

### Feeds

| instagram-private-api                   | igflare                     |
| --------------------------------------- | --------------------------- |
| `ig.feed.user(userId)`                  | `ig.feed.user(userId)`      |
| `ig.feed.timeline()`                    | `ig.feed.timeline()`        |
| `ig.feed.tags(tag)`, `ig.feed.tag(tag)` | `ig.feed.hashtag(tag)`      |
| `ig.feed.location(id)`                  | `ig.feed.location(id)`      |
| `ig.feed.topicalExplore()`              | `ig.explore.feed()`         |
| `ig.feed.saved()`                       | `ig.media.saved()`          |
| `ig.feed.liked()`                       | `ig.collection.liked()`     |
| `ig.tag.search(query)`                  | `ig.search.hashtags(query)` |

The hashtag feed is the app's search results for `#tag`, ranked by relevance, with no
recent tab. See [Limitations](./limitations).

### Posts and comments

| instagram-private-api                                   | igflare                                                   |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `ig.media.info(mediaId)`                                | `ig.media.info(mediaId)`                                  |
| `ig.media.like({ mediaId, moduleInfo, d })`             | `ig.media.like(mediaId)`                                  |
| `ig.media.unlike({ mediaId, moduleInfo })`              | `ig.media.unlike(mediaId)`                                |
| `ig.media.likers(mediaId)`                              | `ig.media.likers(mediaId)`                                |
| `ig.media.comment({ mediaId, text })`                   | `ig.media.comment(mediaId, text)`                         |
| `ig.media.comment({ mediaId, text, replyToCommentId })` | `ig.media.comment(mediaId, text, { repliedToCommentId })` |
| `ig.feed.mediaComments(mediaId)`                        | `ig.media.comments(mediaId)`                              |
| `ig.feed.mediaInlineChildComments(mediaId, commentId)`  | `ig.media.replies(mediaId, commentId)`                    |
| `ig.media.likeComment(commentId)`                       | `ig.media.likeComment(commentId)`                         |
| `ig.media.unlikeComment(commentId)`                     | `ig.media.unlikeComment(commentId)`                       |
| `ig.media.commentsBulkDelete(mediaId, commentIds)`      | `ig.media.deleteComments(mediaId, commentIds)`            |
| `ig.media.editMedia({ mediaId, captionText })`          | `ig.media.edit(mediaId, { caption })`                     |
| `ig.media.delete({ mediaId, mediaType })`               | `ig.media.delete(mediaId, mediaType)`                     |
| `ig.media.save(mediaId)`                                | `ig.media.save(mediaId)`                                  |
| `ig.media.save(mediaId, [collectionId])`                | `ig.media.save(mediaId, { collectionId })`                |
| `ig.media.onlyMe(mediaId)`                              | `ig.media.archive(mediaId)`                               |
| `ig.media.undoOnlyMe(mediaId)`                          | `ig.media.unarchive(mediaId)`                             |

### Publishing

::: code-group

```ts [instagram-private-api]
await ig.publish.photo({ file: jpeg, caption: 'hello' });
await ig.publish.video({
  video: mp4,
  coverImage: coverJpeg,
  caption: 'hello',
});
await ig.publish.album({
  items: [{ file: jpeg }, { video: mp4, coverImage: coverJpeg }],
  caption: 'hello',
});
await ig.publish.story({ file: jpeg });
```

:::

::: code-group

```ts [igflare]
await ig.upload.photo(jpeg, { caption: 'hello' });
await ig.upload.video(mp4, coverJpeg, { caption: 'hello' });
const items = [{ photo: jpeg }, { video: mp4, cover: coverJpeg }];
await ig.upload.album(items, { caption: 'hello' });
await ig.upload.story(jpeg);

await ig.upload.reel(mp4, coverJpeg, { caption: 'hello' });
```

:::

Uploads take a `Buffer` or any `Uint8Array`. Video duration and size are read from the MP4.
People are tagged after posting, with `ig.media.edit(mediaId, { caption, tag })`. See
[Publishing](./publishing).

### Stories and highlights

| instagram-private-api                           | igflare                                   |
| ----------------------------------------------- | ----------------------------------------- |
| `ig.feed.reelsTray()`                           | `ig.story.tray()`                         |
| `ig.feed.userStory(userId)`                     | `ig.story.user(userId)`                   |
| `ig.story.seen(items)`                          | `ig.story.markSeen(storyIds)`             |
| `ig.highlights.highlightsTray(userId)`          | `ig.highlight.list(userId)`               |
| `ig.highlights.createReel({ title, mediaIds })` | `ig.highlight.create(title, storyIds)`    |
| `ig.highlights.editReel(options)`               | `ig.highlight.edit(highlightId, options)` |
| `ig.highlights.deleteReel(highlightId)`         | `ig.highlight.delete(highlightId)`        |

### Direct messages

::: code-group

```ts [instagram-private-api]
const thread = ig.entity.directThread(threadId);
await thread.broadcastText('hi');
await thread.broadcastPhoto({ file: jpeg });

await ig.entity.directThread([userId]).broadcastText('hi');
```

:::

::: code-group

```ts [igflare]
await ig.direct.sendText('hi', { threadId });
await ig.direct.sendPhoto(jpeg, { threadId });

await ig.direct.sendText('hi', { userIds: [userId] });
```

:::

| instagram-private-api                                | igflare                                     |
| ---------------------------------------------------- | ------------------------------------------- |
| `ig.feed.directInbox()`                              | `ig.direct.inbox()`                         |
| `ig.feed.directPending()`                            | `ig.direct.pending()`                       |
| `ig.feed.directThread({ thread_id, oldest_cursor })` | `ig.direct.thread(threadId, { cursor })`    |
| `thread.broadcastText(text)`                         | `ig.direct.sendText(text, target)`          |
| `thread.broadcastLink(text, urls)`                   | `ig.direct.sendLink(text, target)`          |
| `thread.broadcastPhoto({ file })`                    | `ig.direct.sendPhoto(jpeg, target)`         |
| `thread.broadcastVideo({ video })`                   | `ig.direct.sendVideo(mp4, target)`          |
| `thread.broadcastVoice({ file })`                    | `ig.direct.sendVoice(m4a, target)`          |
| `thread.broadcastPost(mediaId)`                      | `ig.direct.shareMedia(mediaId, target)`     |
| `thread.broadcastProfile(userId)`                    | `ig.direct.shareProfile(userId, target)`    |
| `thread.broadcastUserStory({ mediaId })`             | `ig.direct.shareStory(storyId, target)`     |
| `thread.deleteItem(itemId)`                          | `ig.direct.deleteMessage(threadId, itemId)` |
| `ig.direct.createGroupThread(userIds, title)`        | `ig.direct.createGroup(userIds, title)`     |
| `ig.directThread.getByParticipants(userIds)`         | `ig.direct.findThread(userIds)`             |
| `ig.directThread.updateTitle(threadId, title)`       | `ig.direct.setTitle(threadId, title)`       |
| `ig.directThread.addUser(threadId, userIds)`         | `ig.direct.addUsers(threadId, userIds)`     |
| `ig.directThread.approve(threadId)`                  | `ig.direct.approve(threadId)`               |
| `ig.directThread.mute(threadId)`                     | `ig.direct.mute(threadId)`                  |
| `ig.directThread.unmute(threadId)`                   | `ig.direct.unmute(threadId)`                |
| `ig.directThread.hide(threadId)`                     | `ig.direct.hide(threadId)`                  |
| `ig.directThread.markItemSeen(threadId, itemId)`     | `ig.direct.markSeen(threadId, itemId)`      |
| `ig.direct.rankedRecipients(mode, query)`            | `ig.direct.searchRecipients(query)`         |

`target` is `{ threadId }` or `{ userIds }`. Photos go to existing threads only.

### Insights

| instagram-private-api                | igflare                                    |
| ------------------------------------ | ------------------------------------------ |
| `ig.insights.account(options)`       | `ig.insights.account({ from, to })`        |
| `ig.insights.post(mediaId)`          | `ig.insights.post(mediaId)`                |
| `ig.feed.postsInsightsFeed(options)` | `ig.insights.content({ type: 'posts' })`   |
| `ig.feed.storiesInsights(timeframe)` | `ig.insights.content({ type: 'stories' })` |

Reels have their own call, `ig.insights.reel(mediaId)`, and the audience has
`ig.insights.audience()`. See [Insights](./insights).

### Raw requests

::: code-group

```ts [instagram-private-api]
const { body } = await ig.request.send({
  url: '/api/v1/accounts/current_user/',
});
```

:::

::: code-group

```ts [igflare]
const json = await ig.client.request({
  method: 'GET',
  endpoint: '/api/v1/accounts/current_user/',
});
```

:::

`ig.client` sends the request with the session's device and login headers, and maps a
failure to the same typed errors.

## No direct equivalent

- **Logout, password, private or public profile, username and email changes.** Not
  covered.
- **Location and people tags on upload.** People are tagged afterwards with `media.edit`.
  A location has no call.
- **Story videos.** Stories take a photo.
- **IGTV.** Instagram retired it. Videos post with `ig.upload.video` or `ig.upload.reel`.
- **Live, music, story stickers and their votes, the blocked users list, usertag feeds.**
  Not covered. The full list is in [Limitations](./limitations).
- **Realtime direct messages.** Not covered. The inbox and threads are read by request.

## Credits

instagram-private-api mapped most of the private API for Node and has been the reference
for it for years. Its method names made the table above possible.
