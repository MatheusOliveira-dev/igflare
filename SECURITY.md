# Security

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose
**Report a vulnerability**. Do not open a public issue for it.

Include what is affected, how to reproduce it, and what an attacker could do with it. A
first answer comes within a week. A fix is released as soon as it is ready, and the report
is credited unless the reporter asks otherwise.

## Supported versions

Only the latest release gets fixes.

## What counts

Problems in this library: a request that sends something other than what the caller asked
for, a session or password leaking into logs or errors, a path or body that a caller's input
can rewrite, a proxy setting that sends traffic around the proxy.

Instagram's own behavior (blocks, challenges, rate limits) is not a vulnerability here. See
`LIMITATIONS.md` for what to expect from the service.

## Handling sessions

A saved session holds the account's login token. Treat the file `FileSessionStore` writes
like a password: keep it out of version control and out of shared storage.
