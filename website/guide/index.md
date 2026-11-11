# What is igflare

igflare is a TypeScript client for Instagram's mobile private API: the API the Instagram
app for Android talks to. It logs in like the app, sends the headers and requests the app
sends, and turns the answers into typed objects.

```ts
const user = await ig.user.infoByUsername('instagram');
user.follower_count; // number, checked at runtime
```

## How it works

Instagram has no public API for most of what its app does. igflare speaks the app's own
protocol instead:

- **Login** goes through the same flow the current app uses, including two-factor codes and
  email challenges.
- **Requests** carry the headers, signatures and device identity of one Android app build.
  The newer screens of the app are served by persisted GraphQL queries, and igflare sends
  the same query ids, read from that build.
- **Answers** are checked against schemas. The fields igflare exposes are typed, and
  anything Instagram adds passes through untouched.

When Instagram ships a new app build, a script compares igflare's query ids with the ones
the new build carries. See [New app builds](./app-builds).

## What is included

- A client object, `ig`, with the calls grouped the way the app groups them:
  `ig.account`, `ig.user`, `ig.friendship`, `ig.feed`, `ig.media`, `ig.upload`,
  `ig.direct`, `ig.insights` and more.
- A checked model from every call, and a typed error when one fails. There is no
  `{ ok, data }` wrapper to unpack.
- Page calls and iterators for every list.
- Saved, reusable sessions, with re-login when one expires.
- Retries with backoff, an optional proxy, and pluggable network and session storage.

## Before starting

::: warning Unofficial
igflare is not affiliated with or endorsed by Meta or Instagram. Using the private API can
go against Instagram's Terms of Use, and an account that acts like a bot can be limited or
blocked. A disposable account is the safe choice during development. Details in
[limitations](./limitations).
:::

Ready? Go to [Getting started](./getting-started).
