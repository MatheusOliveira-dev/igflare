# Getting started

## Install

::: code-group

```sh [npm]
npm install igflare
```

```sh [pnpm]
pnpm add igflare
```

```sh [yarn]
yarn add igflare
```

:::

igflare needs Node 22 or newer. It ships ESM and CommonJS builds with type declarations,
and its only runtime dependency is `zod`.

## A first script

```ts
import { IgFlare, FileSessionStore } from 'igflare';

// The session (device identity and login token) is saved in this file.
const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'));

if (ig.session.auth.userId === undefined) {
  await ig.login({
    username: process.env.IG_USERNAME!,
    password: process.env.IG_PASSWORD!,
  });
}

const me = await ig.account.me();
console.log('logged in as', me['username']);

const user = await ig.user.infoByUsername('instagram');
console.log(user.full_name, user.follower_count, 'followers');

for await (const post of ig.feed.paginateUser(String(user.pk))) {
  console.log(post.code, post.like_count);
  break; // one is enough for a first run
}
```

The first run logs in and writes `session.json`. The next runs read it and skip the login.

## Keep the session

Instagram ties a login to a device. A script that logs in from a fresh device on every run
looks like a new phone each time, and Instagram usually answers with a verification
challenge. Reusing `session.json` limits logins to when the session expires.

::: danger The session file is a secret
It holds the account's login token, so it stays out of version control and shared
storage.
:::

## Next steps

- [Logging in](./authentication): two-factor codes, challenges and expired sessions.
- [Results and errors](./errors): what a call returns and what it throws.
- [Lists and pagination](./pagination): pages, cursors and iterators.
