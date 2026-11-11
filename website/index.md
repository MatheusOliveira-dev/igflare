---
layout: home

hero:
  name: igflare
  text: Instagram's private API, typed.
  tagline: A TypeScript client that talks to Instagram the way the Android app does. Every call returns a checked model or throws a typed error.
  image:
    src: /logo.svg
    alt: igflare
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: What is igflare?
      link: /guide/
    - theme: alt
      text: API reference
      link: /api/

features:
  - icon:
      src: /icons/protocol.svg
      width: 28
      height: 28
    title: The current protocol
    details: The login flow, headers and GraphQL queries of the current app build, read from the app itself. A script checks them against each new build.
  - icon:
      src: /icons/typed.svg
      width: 28
      height: 28
    title: Typed end to end
    details: Results are checked at runtime against lenient schemas. Each failure has its own error class. Ids are exact 64-bit strings.
  - icon:
      src: /icons/session.svg
      width: 28
      height: 28
    title: Sessions that last
    details: Log in once and reuse the saved session. Re-login on expiry, two-factor codes, retries with backoff and an optional proxy.
  - icon:
      src: /icons/surface.svg
      width: 28
      height: 28
    title: Most of the app
    details: Profiles, follows, feeds, posts, comments, stories, highlights, notes, reels, direct messages and insights.
  - icon:
      src: /icons/small.svg
      width: 28
      height: 28
    title: Fully documented
    details: Every public export carries a doc comment, published as this guide and a complete API reference.
  - icon:
      src: /icons/tested.svg
      width: 28
      height: 28
    title: Tested against the real service
    details: The calls were checked on a live account, and a read-only check runs against the service before each release.
---

<div class="home-section vp-doc">

## A first call

```ts
import { IgFlare, FileSessionStore } from 'igflare';

const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'));
if (ig.session.auth.userId === undefined) await ig.login({ username, password });

const user = await ig.user.infoByUsername('instagram');
console.log(user.full_name, user.follower_count);
```

## Coverage

| Area             | Calls                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| **Account**      | Profile, biography, name, links, profile picture, activity                               |
| **Follow graph** | Follow, followers and following, requests, block, mute, close friends                    |
| **Feeds**        | Timeline, user, hashtag, place, reels and Explore, with iterators                        |
| **Posts**        | Likes, comments and replies, saving and collections, editing and tags, archive and pin   |
| **Publishing**   | Photo, video, carousel, reel, story, highlights and notes                                |
| **Direct**       | Inbox and requests, text, links, photos, videos, voice, shared posts and stories, groups |
| **Insights**     | Account overview, audience, content ranking, post and reel insights                      |

::: warning Unofficial
igflare is not affiliated with or endorsed by Meta or Instagram. Using the private API can
go against Instagram's Terms of Use and lead to account restrictions. Known limits are in
[limitations](/guide/limitations).
:::

</div>
