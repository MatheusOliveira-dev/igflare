# Logging in

```ts
await ig.login({ username, password });
```

`login` goes through the same flow the current app uses. On success the session holds the
login token, and the client's store saves it.

## Verification codes

Instagram often asks for a code: a second factor the account turned on, or a challenge
sent to the account's email when the login looks new. `twoFactor` tells `login` where the
code comes from, and it answers whichever one Instagram asks for.

```ts
// Called once the code screen is open, which is when Instagram sends the code.
await ig.login({ username, password, twoFactor: { provider: () => askUser('Code: ') } });

// Computed from an authenticator secret.
await ig.login({ username, password, twoFactor: { totpSecret: 'ABCD EFGH IJKL MNOP' } });

// Known in advance.
await ig.login({ username, password, twoFactor: { code: '123456' } });
```

A function fits most cases: the code is only requested once it exists, and it can come
from a terminal, a form or an inbox.

### Finishing it manually

Without `twoFactor`, a login that needs a code throws `CaaTwoFactorRequiredError`. The
error plus the code finish the login:

```ts
import { CaaTwoFactorRequiredError } from 'igflare';

try {
  await ig.login({ username, password });
} catch (error) {
  if (!(error instanceof CaaTwoFactorRequiredError)) throw error;
  await ig.resolveTwoFactor(error, await askUser('Code: '));
}
```

## When something goes wrong

| Error                          | Meaning                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `BadPasswordError`             | The password is wrong.                                    |
| `InvalidVerificationCodeError` | The code was refused. Ask for it again.                   |
| `ChallengeRequiredError`       | Instagram wants a verification the flow could not answer. |
| `AccountSuspendedError`        | The account is suspended. Nothing to retry.               |
| `PleaseWaitError`              | Too many attempts. Wait some minutes before the next one. |

::: tip Do not retry logins in a loop
A second challenged login right after the first usually does not get a new code until some
minutes have passed. Retrying fast makes the account look more like a bot.
:::

## When the session expires

A session lasts a long time, but not forever. Two options decide what happens when
Instagram answers `login_required`:

```ts
// Re-login with the credentials of the last login(), then the request is repeated.
// The credentials stay in this process's memory.
new IgFlare({ store, autoRelogin: true });

// Re-login handled by the caller; igflare holds no credentials.
new IgFlare({ store, onSessionExpired: async () => relogin() });
```

Either way the failed request is repeated once, and requests that fail at the same moment
share a single re-login. With neither option, the call throws `LoginRequiredError`.
