# Results and errors

Every call returns its model or throws. There is no `{ ok, data }` wrapper: if nothing was
thrown, it worked.

```ts
const user = await ig.user.infoByUsername('instagram'); // a User, already checked
```

## Models

Answers are checked at runtime against schemas that are lenient on purpose:

- The fields igflare exposes are typed. Fields that Instagram sometimes leaves out are
  optional, and fields that can be `null` say so.
- Everything else passes through untouched, so a field Instagram adds tomorrow does not
  break existing code, and it stays readable.

If an answer does not fit its schema at all, the call throws `ClientSchemaError` with the
raw body in `error.raw`, which shows what changed.

## Ids

Instagram ids are 64-bit and do not fit in a JavaScript number. igflare keeps them as
strings and never rounds them.

A post has two ids: `pk`, the number, and `id`, which is `pk_authorid`. Calls that act on a
post take the `id`. Ids go into URLs only after a check, so a value like `1/../logout` is
refused before anything is sent.

## Errors

All errors extend `IgError`. Errors that come from an Instagram answer extend `IgApiError`,
which carries the HTTP status in `statusCode` and the parsed body in `payload.raw`.

```ts
import { IgApiError, RateLimitError, ChallengeRequiredError } from 'igflare';

try {
  await ig.friendship.follow(pk);
} catch (error) {
  if (error instanceof RateLimitError) {
    // slow down
  } else if (error instanceof ChallengeRequiredError) {
    // Instagram wants a verification
  } else if (error instanceof IgApiError) {
    console.log(error.statusCode, error.payload.message);
  } else {
    throw error;
  }
}
```

| Error                          | When                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| `LoginRequiredError`           | The session expired or was logged out.                         |
| `CaaTwoFactorRequiredError`    | Login needs a code. See [Logging in](./authentication).        |
| `InvalidVerificationCodeError` | A code was refused.                                            |
| `BadPasswordError`             | The password is wrong.                                         |
| `ChallengeRequiredError`       | Instagram wants a verification before going on.                |
| `AccountSuspendedError`        | The account is suspended.                                      |
| `FeedbackRequiredError`        | Instagram blocked the action for now ("try again later").      |
| `RateLimitError`               | Too many requests. Slow down.                                  |
| `PleaseWaitError`              | "Please wait a few minutes before you try again."              |
| `SentryBlockError`             | The request was flagged as automated.                          |
| `ClientForbiddenError`         | A 403 that is not an expired session.                          |
| `IgApiError`                   | Any other refused request.                                     |
| `ClientSchemaError`            | The answer did not fit its schema.                             |
| `ClientJsonError`              | The answer was not JSON.                                       |
| `IgError`                      | A bad argument, such as a malformed id, caught before sending. |

Transient failures (connection errors, 429, 502, 503 and 504) are retried before an error
is thrown. See [Proxies, retries and transports](./network).
