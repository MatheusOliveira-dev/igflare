# Sessions

A session is everything that makes igflare look like one phone: the device identity, the
app build it reports, and, once logged in, the login token. A saved session allows one
login to last for weeks.

## Stores

A store loads and saves the session. igflare saves after every request that changes it.

```ts
import { IgFlare, FileSessionStore, MemorySessionStore } from 'igflare';

const ig = await IgFlare.fromStore(new FileSessionStore('./session.json'));
const test = new IgFlare({ store: new MemorySessionStore() }); // nothing written to disk
```

`fromStore` starts from the saved session, or from a new device when there is none.

## Custom store

A store is two methods, so keeping sessions in a database, a secret manager or anything
else is short:

```ts
import type { SessionStore, SessionData } from 'igflare';

class RedisStore implements SessionStore {
  constructor(private readonly key: string) {}

  async load(): Promise<SessionData | null> {
    const raw = await redis.get(this.key);
    return raw === null ? null : (JSON.parse(raw) as SessionData);
  }

  async save(data: SessionData): Promise<void> {
    await redis.set(this.key, JSON.stringify(data));
  }
}
```

Each account needs its own store. Two accounts sharing a session would share a device,
which is exactly what Instagram watches for.

## What is inside

`ig.session` is the current session. The most used fields:

```ts
ig.session.auth.userId; // the logged-in account's id, undefined before login
ig.session.profile.appVersion; // the app build igflare reports
ig.session.location.locale; // the locale it reports, en_US by default
```

::: danger
The session holds the login token and deserves the same care as a password.
:::
