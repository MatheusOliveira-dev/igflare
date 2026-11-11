# Proxies, retries and transports

## Proxies

```ts
new IgFlare({ store, proxy: 'http://user:password@proxy.example:8080' });
```

HTTP and HTTPS proxies are built in. Requests to Instagram go through a CONNECT tunnel: the
proxy sees the host name, not the content. Each request opens its own tunnel and never
reuses a direct connection, so no request slips past the proxy.

A proxy that refuses the tunnel (a wrong password answers `407`) or cannot be reached throws
an `IgError` saying so.

::: tip One account, one address
Instagram notices an account that jumps between countries. A fixed proxy per account
behaves like a phone that keeps its network.
:::

## Retries

Transient failures are retried before an error is thrown: connection errors, HTTP 429, 502,
503 and 504, and Instagram's "please wait a few minutes". Each retry waits longer than the
last, with some randomness, and honors `Retry-After`. A 500 or another client error is not
retried, because repeating it would not help.

```ts
new IgFlare({ retry: false }); // off
new IgFlare({ retry: { maxRetries: 5, baseDelayMs: 2000, maxDelayMs: 60_000 } });
```

| Option        | Default | Meaning                               |
| ------------- | ------- | ------------------------------------- |
| `maxRetries`  | `3`     | Retries after the first attempt       |
| `baseDelayMs` | `1000`  | The first wait, doubled on each retry |
| `maxDelayMs`  | `30000` | The longest wait                      |

Retries are for blips, not for pacing. igflare does not queue calls; pacing a large volume
is up to the caller.

## Custom transport

Everything goes out through a transport: one method that sends a request and returns the
response. A custom one covers SOCKS, a custom agent, logging or recording:

```ts
import { IgFlare, HttpsTransport, type HttpTransport } from 'igflare';

const inner = new HttpsTransport();
const logging: HttpTransport = {
  async request(req) {
    const started = Date.now();
    const res = await inner.request(req);
    console.log(req.method, new URL(req.url).pathname, res.status, Date.now() - started, 'ms');
    return res;
  },
};

new IgFlare({ store, transport: logging });
```

A custom transport is still wrapped with the retries, unless `retry: false` is set. `proxy`
configures the built-in transport, so it cannot be combined with `transport`.

::: warning Headers matter
A transport sends the headers it receives, unchanged. Global `fetch` adds browser headers that
Instagram refuses, which is why the built-in transport uses Node's `https`.
:::
