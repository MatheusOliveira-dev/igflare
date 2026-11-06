<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <img src=".github/assets/banner-light.svg" alt="igflare: Instagram's private API, typed." width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://matheusoliveira-dev.github.io/igflare/"><img src="https://img.shields.io/badge/docs-guide%20%26%20API-f4613a" alt="docs"></a>
  <a href="https://github.com/MatheusOliveira-dev/igflare/actions/workflows/ci.yml"><img src="https://github.com/MatheusOliveira-dev/igflare/actions/workflows/ci.yml/badge.svg" alt="ci"></a>
  <a href="package.json"><img src="https://img.shields.io/github/package-json/v/MatheusOliveira-dev/igflare?label=version&color=f4613a" alt="version"></a>
  <img src="https://img.shields.io/badge/types-TypeScript-3178c6" alt="TypeScript">
  <img src="https://img.shields.io/badge/node-%E2%89%A522-339933" alt="Node 22 or newer">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/MatheusOliveira-dev/igflare?color=59636e" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://matheusoliveira-dev.github.io/igflare/guide/"><b>Guide</b></a> ·
  <a href="https://matheusoliveira-dev.github.io/igflare/api/"><b>API reference</b></a> ·
  <a href="https://github.com/MatheusOliveira-dev/igflare/tree/main/examples"><b>Examples</b></a> ·
  <a href="CHANGELOG.md"><b>Changelog</b></a>
</p>

<p align="center">
  A TypeScript client for the Instagram private API, the one the Android app uses.<br>
  Login, profiles, feeds, publishing, direct messages and insights, with typed results and
  typed errors.
</p>

<table>
  <tr>
    <td width="33%" valign="top">
      <img src="website/public/icons/protocol.svg" width="26" alt=""><br>
      <b>Official app protocol</b><br>
      Login flow, headers and GraphQL queries extracted from the official Android app. A
      script compares them against each new app build.
    </td>
    <td width="33%" valign="top">
      <img src="website/public/icons/typed.svg" width="26" alt=""><br>
      <b>Typed end to end</b><br>
      Results validated at runtime, one error class per failure, 64-bit ids kept as exact
      strings.
    </td>
    <td width="33%" valign="top">
      <img src="website/public/icons/session.svg" width="26" alt=""><br>
      <b>Long-lived sessions</b><br>
      Saved sessions, re-login on expiry, two-factor codes, retries with backoff and proxy
      support.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="website/public/icons/surface.svg" width="26" alt=""><br>
      <b>Broad coverage</b><br>
      Over 100 calls across profiles, the follow graph, feeds, posts, publishing, stories,
      direct messages and insights.
    </td>
    <td valign="top">
      <img src="website/public/icons/small.svg" width="26" alt=""><br>
      <b>Fully documented</b><br>
      Every public export carries a doc comment, published as a guide and a complete API
      reference.
    </td>
    <td valign="top">
      <img src="website/public/icons/tested.svg" width="26" alt=""><br>
      <b>Live-tested</b><br>
      Each call validated on a real account. A read-only check against the live service runs
      before every release.
    </td>
  </tr>
</table>

> [!WARNING]
> Unofficial client, not affiliated with or endorsed by Meta or Instagram. Use of the private
> API can break Instagram's Terms of Use and lead to account restrictions. Known limits are in
> [LIMITATIONS.md](LIMITATIONS.md).

## Install

```sh
npm install igflare
```

> [!TIP]
> Requires Node 22 or newer. Ships ESM and CommonJS builds with type declarations, and `zod`
> is the only runtime dependency.

## Quick start

```ts
import { IgFlare, FileSessionStore } from 'igflare';

// The saved session spares later runs a new login and its device challenge.
const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'));

if (ig.session.auth.userId === undefined) {
  await ig.login({ username, password });
}

const user = await ig.user.infoByUsername('instagram');
console.log(user.username, user.follower_count);

for await (const post of ig.feed.paginateUser(String(user.pk))) {
  console.log(post.code, post.like_count);
}
```

## Coverage

<table>
  <tr>
    <td width="33%" valign="top">
      <img src=".github/assets/icons/account.svg" width="20" alt="">&nbsp;<b>Account</b>&nbsp;<sub>9 calls</sub><br>
      <sub>Profile, biography, name, links, profile picture, activity feed</sub>
    </td>
    <td width="33%" valign="top">
      <img src=".github/assets/icons/search.svg" width="20" alt="">&nbsp;<b>Users and search</b>&nbsp;<sub>8 calls</sub><br>
      <sub>Profiles by id or username, users, hashtags, places nearby</sub>
    </td>
    <td width="33%" valign="top">
      <img src=".github/assets/icons/follow.svg" width="20" alt="">&nbsp;<b>Follow graph</b>&nbsp;<sub>15 calls</sub><br>
      <sub>Follow, followers, following, requests, block, mute, close friends</sub>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src=".github/assets/icons/feeds.svg" width="20" alt="">&nbsp;<b>Feeds</b>&nbsp;<sub>8 calls</sub><br>
      <sub>Timeline, user, hashtag, place, reels and Explore</sub>
    </td>
    <td valign="top">
      <img src=".github/assets/icons/posts.svg" width="20" alt="">&nbsp;<b>Posts</b>&nbsp;<sub>22 calls</sub><br>
      <sub>Likes, comments and replies, saves and collections, tags, archive, pin, delete</sub>
    </td>
    <td valign="top">
      <img src=".github/assets/icons/publish.svg" width="20" alt="">&nbsp;<b>Publishing</b>&nbsp;<sub>5 calls</sub><br>
      <sub>Photo, video, carousel, reel and story</sub>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src=".github/assets/icons/stories.svg" width="20" alt="">&nbsp;<b>Stories and notes</b>&nbsp;<sub>11 calls</sub><br>
      <sub>Tray, user stories, seen receipts, highlights, notes</sub>
    </td>
    <td valign="top">
      <img src=".github/assets/icons/direct.svg" width="20" alt="">&nbsp;<b>Direct</b>&nbsp;<sub>19 calls</sub><br>
      <sub>Inbox, requests, text, links, media, voice, shares, reactions, groups</sub>
    </td>
    <td valign="top">
      <img src=".github/assets/icons/insights.svg" width="20" alt="">&nbsp;<b>Insights</b>&nbsp;<sub>5 calls</sub><br>
      <sub>Account overview, audience, content ranking, post and reel metrics</sub>
    </td>
  </tr>
</table>

Each list has a page call and an async iterator.

<details>
<summary><b>All methods</b></summary>

<!-- prettier-ignore-start -->
```ts
ig.account.me();                          ig.account.setBiography(text);  ig.account.setName(name);
ig.account.links();                       ig.account.setLink(url, title); ig.account.removeLinks(ids);
ig.account.setPicture(jpeg);              ig.account.removePicture();     ig.account.activity();

ig.user.info(pk);                         ig.user.infoByUsername(name);
ig.search.users(q);                       ig.search.hashtags(q);          ig.search.places(q);
ig.hashtag.info(tag);                     ig.location.info(id);           ig.location.nearby(lat, lng);

ig.friendship.follow(pk);                 ig.friendship.unfollow(pk);     ig.friendship.status(pk);
ig.friendship.followers(pk);              ig.friendship.following(pk);
ig.friendship.pending();                  ig.friendship.approve(pk);      ig.friendship.deny(pk);
ig.friendship.block(pk);                  ig.friendship.unblock(pk);
ig.friendship.mute(pk);                   ig.friendship.unmute(pk);
ig.friendship.removeFollower(pk);         ig.friendship.addCloseFriend(pk);
ig.friendship.removeCloseFriend(pk);

ig.feed.user(pk);                         ig.feed.timeline();
ig.feed.hashtag(tag);                     ig.feed.location(id);
ig.reels.user(userId);                    ig.reels.feed();                ig.reels.explore();
ig.explore.feed();

ig.media.info(id);                        ig.media.like(id);              ig.media.unlike(id);
ig.media.comment(id, text);               ig.media.comment(id, text, { repliedToCommentId });
ig.media.comments(id);                    ig.media.replies(id, commentId);
ig.media.likeComment(commentId);          ig.media.pinComment(id, commentId);
ig.media.deleteComment(id, commentId);    ig.media.deleteComments(id, commentIds);
ig.media.likers(id);                      ig.media.save(id);              ig.media.saved();
ig.media.edit(id, { caption, tag, untag });
ig.media.archive(id);                     ig.media.pin(id);               ig.media.delete(id);

ig.collection.list();                     ig.collection.medias(id);       ig.collection.liked();
ig.collection.create(name);               ig.collection.delete(id);       ig.media.save(id, { collectionId });

ig.upload.photo(jpeg, { caption });       ig.upload.video(mp4, coverJpeg, { caption });
ig.upload.album([{ photo: jpeg }, { video: mp4, cover: jpeg }], { caption });
ig.upload.reel(mp4, coverJpeg, { caption });
ig.upload.story(jpeg);

ig.story.tray();                          ig.story.user(pk);              ig.story.markSeen(ids);
ig.highlight.list(userId);                ig.highlight.info(id);          ig.highlight.create(title, storyIds);
ig.highlight.edit(id, options);           ig.highlight.delete(id);
ig.notes.list();                          ig.notes.create(text);          ig.notes.delete(id);

ig.direct.inbox();                        ig.direct.thread(threadId);
ig.direct.sendText(text, target);         ig.direct.sendLink(text, target);
ig.direct.sendPhoto(jpeg, target);        ig.direct.sendVideo(mp4, target);
ig.direct.sendVoice(m4a, target);         ig.direct.shareStory(storyId, target);
ig.direct.shareMedia(id, target);         ig.direct.shareProfile(pk, target);
ig.direct.react(threadId, itemId);        ig.direct.deleteMessage(threadId, itemId);
ig.direct.createGroup(userIds, title);    ig.direct.setTitle(threadId, title);
ig.direct.addUsers(threadId, userIds);    ig.direct.findThread(userIds);
ig.direct.pending();                      ig.direct.spam();               ig.direct.approve(threadId);

ig.insights.account({ from, to });        ig.insights.audience();         ig.insights.content({ type: 'reels' });
ig.insights.post(mediaId);                ig.insights.reel(mediaId);
```
<!-- prettier-ignore-end -->

`ig.client` exposes the underlying engine for requests the facade does not wrap.

</details>

## Examples

<details>
<summary><img src=".github/assets/icons/account.svg" width="16" alt="">&nbsp;<b>Two-factor and login challenges</b></summary>

```ts
// Asked for once the code screen opens, which is when Instagram sends the code.
await ig.login({ username, password, twoFactor: { provider: () => promptUser('Code: ') } });

// Computed from an authenticator secret.
await ig.login({ username, password, twoFactor: { totpSecret: 'ABCD EFGH IJKL MNOP' } });

// Known in advance.
await ig.login({ username, password, twoFactor: { code: '123456' } });
```

Without `twoFactor`, `login` throws `CaaTwoFactorRequiredError` and
`ig.resolveTwoFactor(error, code)` completes it. A refused code throws
`InvalidVerificationCodeError`, a wrong password `BadPasswordError`.

</details>

<details>
<summary><img src="website/public/icons/session.svg" width="16" alt="">&nbsp;<b>Session storage and expiry</b></summary>

`FileSessionStore` and `MemorySessionStore` ship with the package. Any other storage is a
two-method interface:

```ts
import type { SessionStore, SessionData } from 'igflare';

class DatabaseStore implements SessionStore {
  async load(): Promise<SessionData | null> {
    /* read */
  }
  async save(data: SessionData): Promise<void> {
    /* write */
  }
}
```

On expiry:

```ts
// Re-login with the last credentials, held in memory, then the request is repeated.
new IgFlare({ store, autoRelogin: true });

// Re-login handled by the caller; no credentials are held.
new IgFlare({ store, onSessionExpired: async () => relogin() });
```

Requests that expire together share one re-login. With neither option,
`LoginRequiredError` is thrown.

</details>

<details>
<summary><img src="website/public/icons/typed.svg" width="16" alt="">&nbsp;<b>Errors</b></summary>

Calls return the model or throw. There is no `{ ok, data }` wrapper.

```ts
import { IgApiError, RateLimitError, ChallengeRequiredError } from 'igflare';

try {
  await ig.friendship.follow(pk);
} catch (error) {
  if (error instanceof RateLimitError) {
    // rate limited
  } else if (error instanceof ChallengeRequiredError) {
    // verification required
  } else if (error instanceof IgApiError) {
    console.log(error.statusCode, error.payload.message);
  }
}
```

Schemas are lenient: exposed fields are typed and unknown fields pass through. A response
that does not match throws `ClientSchemaError` with the raw body attached.

A post has two ids: `pk` (numeric) and `id` (`pk_authorid`). Post methods take the `id`.

</details>

<details>
<summary><img src=".github/assets/icons/feeds.svg" width="16" alt="">&nbsp;<b>Pagination</b></summary>

```ts
const page = await ig.friendship.followers(pk);
page.items; // User[]
page.nextCursor; // undefined on the last page

const next = await ig.friendship.followers(pk, { cursor: page.nextCursor });

for await (const user of ig.friendship.paginateFollowers(pk)) {
  // pages load on demand
}
```

</details>

<details>
<summary><img src=".github/assets/icons/publish.svg" width="16" alt="">&nbsp;<b>Uploads</b></summary>

```ts
import { readFile } from 'node:fs/promises';

await ig.upload.photo(await readFile('photo.jpg'), { caption: 'hello' });
await ig.upload.reel(await readFile('clip.mp4'), await readFile('cover.jpg'));
```

Photos and covers are JPEG. Videos take a separate JPEG cover; duration and size are read
from the MP4.

</details>

<details>
<summary><img src=".github/assets/icons/direct.svg" width="16" alt="">&nbsp;<b>Direct messages</b></summary>

```ts
await ig.direct.sendText('hi', { threadId });
await ig.direct.sendText('hi', { userIds: ['123'] });
await ig.direct.sendVoice(await readFile('voice.m4a'), { threadId });
```

Photos go to existing threads only.

</details>

<details>
<summary><img src=".github/assets/icons/insights.svg" width="16" alt="">&nbsp;<b>Insights</b></summary>

Business and creator accounts only. Ranges default to the last 30 days.

```ts
const week = { from: new Date(Date.now() - 7 * 86_400_000), to: new Date() };

const overview = await ig.insights.account(week); // views, reach, interactions, visits
const audience = await ig.insights.audience(week); // followers, ages, places, active times
const top = await ig.insights.content({ ...week, type: 'reels', metric: 'likes', count: 5 });
const reel = await ig.insights.reel(reelId); // watch time, rate of each reaction
```

</details>

<details>
<summary><img src="website/public/icons/protocol.svg" width="16" alt="">&nbsp;<b>Proxy, retries and transport</b></summary>

```ts
new IgFlare({ store, proxy: 'http://user:password@proxy.example:8080' });

new IgFlare({ retry: false });
new IgFlare({ retry: { maxRetries: 5, baseDelayMs: 2000 } });
```

HTTP and HTTPS proxies use a CONNECT tunnel per request. SOCKS or any other network layer
fits through the one-method `HttpTransport` interface.

Connection errors, 429, 502, 503, 504 and "please wait a few minutes" are retried up to three
times with exponential backoff and jitter, honoring `Retry-After`.

</details>

## Documentation

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://matheusoliveira-dev.github.io/igflare/guide/"><b>Guide</b></a><br>
      <sub>From the first login to insights</sub>
    </td>
    <td width="50%" valign="top">
      <a href="https://matheusoliveira-dev.github.io/igflare/api/"><b>API reference</b></a><br>
      <sub>Every function, option and type</sub>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <a href="https://github.com/MatheusOliveira-dev/igflare/tree/main/examples"><b>Examples</b></a><br>
      <sub>Runnable scripts, type-checked with the code</sub>
    </td>
    <td valign="top">
      <a href="LIMITATIONS.md"><b>Limitations</b></a><br>
      <sub>What is not covered and how the service behaves</sub>
    </td>
  </tr>
  <tr>
    <td valign="top">
      <a href="CHANGELOG.md"><b>Changelog</b></a><br>
      <sub>Changes in each release</sub>
    </td>
    <td valign="top">
      <a href="SECURITY.md"><b>Security</b></a><br>
      <sub>Private vulnerability reports</sub>
    </td>
  </tr>
</table>

## Development

```sh
npm install
npm run ci
```

`npm run ci` runs every gate: types, lint, format, boundaries, duplication, dead code,
generated code, tests with coverage, build, API report and docs. Layout in
[ARCHITECTURE.md](ARCHITECTURE.md), contribution rules in [CONTRIBUTING.md](CONTRIBUTING.md).

<details>
<summary><b>Moving to a new app build</b></summary>

```sh
npm run app-build -- path/to/base.apk --build 455.0.0.12.34          # report the differences
npm run app-build -- path/to/base.apk --build 455.0.0.12.34 --write  # apply them
npm run gen
IGFLARE_SESSION=session.json npm run live-check -- --professional
```

The device profile's app version changes by hand in the same commit.

</details>

## License

[MIT](LICENSE). Instagram is a trademark of Meta Platforms, Inc. This project is not
affiliated with Meta.
