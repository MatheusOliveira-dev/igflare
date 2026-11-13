# Limitations and risks

What igflare does not do, and what to expect from the service.

## It is unofficial

igflare talks to Instagram the way the Android app does. It is not an official API, it
is not affiliated with or endorsed by Meta or Instagram, and Instagram does not support
it. Using the private API can go against Instagram's Terms of Use. Instagram can
challenge, restrict or disable an account that uses it, and no client can promise it
will not. Responsibility for its use lies with the user. It is not meant for spam or for
collecting other people's data against their wishes.

## It can break without notice

The protocol belongs to Instagram and changes when the app changes. This client reports
itself as one app build (`454.0.0.54.77`). While it was written, three things stopped
working as they used to and had to be reworked, and a fourth changed after that:

- the classic `accounts/login/` was retired, and login now goes through the Bloks flow
- the hashtag and location feeds moved from `feed/tag` and `feed/location` to `sections`
- direct photos moved from `configure_photo` to a messenger upload host
- the hashtag page was replaced by the search results screen, so `feed.hashtag` now reads
  those results (see below)

Expect more of this. When it happens, the likely symptoms are a typed `IgApiError`, a
`ClientSchemaError` (a response no longer matches), or a response that is ok but empty.

## How much was checked against the real service

Every endpoint was exercised against the live service on test accounts in November 2026,
on one app profile, and the results were read back where the API allows it. That is a
point-in-time check, not a guarantee. The automated suite does not talk to Instagram: it
uses fakes plus a few captured real responses, so a change on Instagram's side will not
fail the build. It shows up only against the live service.

Known gaps from that testing:

- The hashtag feed is the app's search results for `#tag`, ranked by relevance. There
  is no chronological view, so it cannot be used to watch for new posts. Each post is the
  light form the results grid uses (id, code, type, author, images). Caption, counts and
  date come from `media.info`. It is served by one persisted GraphQL query whose id
  belongs to the app build this client reports (`454.0.0.54.77`). A newer build can
  change it, and the call then fails with a typed error rather than returning nothing.
- The profile link is a list. `setLink` adds an external link to it and `removeLinks`
  takes entries out by id. The display name can be changed, but Instagram allows only a
  couple of name changes per 14 days.
- Insights exist only for professional (business or creator) accounts, and only for the
  account's own media. They use persisted GraphQL queries tied to the same app build, so
  a newer build can break them with a typed error. Account reports are always asked as a
  custom date range. The app's preset periods were refused by the overview query. The
  audience's active times come in the server's default time zone, because any time zone
  sent with the request emptied them. Hidden or still-empty figures arrive as `null`.
- Marking a story as seen was confirmed from the viewer's side. Most other writes were
  confirmed by reading the result back.

## Sessions, devices and challenges

Instagram ties a login to a device. A client that starts from a fresh device each time
will be asked to verify itself, usually with a code sent to the account's email, phone or
WhatsApp. A saved session avoids logging in on every run. In testing, a second challenged
login right after the first did not send a new code until some minutes had passed, so
retrying challenged logins in a loop does not help.

Session files hold the access token and device identity in plain JSON, so they are
secrets, like a password, and stay out of version control. With `autoRelogin`, the
credentials are also kept in the memory of the process.

## Network

- Requests go out through Node's `https`. HTTP and HTTPS proxies are built in. SOCKS needs
  a custom `transport`.
- The client does not imitate the app's TLS fingerprint. The reference client reports
  that this can lead to an empty 429 on login. It was not seen here, but it is not
  handled.
- Retries cover transient failures only. There is no built-in rate limiter or queue, and
  Instagram limits how fast an account may act, so pacing is up to the caller.

## What is not covered

Following a hashtag (Instagram retired it, and the old calls answer ok and do nothing), reels
music and remixes, music notes,
shopping, live, account creation, realtime messaging, story stickers, and notification
settings. Direct messages carry text, links, reactions, shared
posts and profiles, photos, videos, voice messages and shared stories. Instagram has no
generic file attachment in direct.
Some of these may come. Others are unlikely.
