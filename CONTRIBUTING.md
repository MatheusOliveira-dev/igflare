# Contributing

Bug reports, missing endpoints and fixes are welcome. This page covers how to get a change
merged.

## Before starting

- For a bug, open an issue with the call, the igflare version and the error class. A
  minimal script that reproduces it helps most.
- For a new endpoint or a larger change, open an issue first so the shape can be agreed
  before it is written.
- Security problems go through the private report described in [SECURITY.md](SECURITY.md),
  never a public issue.

## Setup

Node 22 or later.

```sh
npm install
npm run ci
```

`npm run ci` is the same gate the pull request runs. If it passes locally, CI passes.

## Rules a change must follow

- **Every function ships with a test.** No test, not merged.
- **Return the validated model, throw a typed error.** Endpoints return the parsed result
  and throw an `IgError` subclass on failure, never a raw string or a plain `Error`. See
  [ARCHITECTURE.md](ARCHITECTURE.md) for the response and error contract.
- **Ids in a URL path go through `core/ids`** (`checkedId` or `checkedMediaId`), never
  string replacement on a caller's value.
- **Do not edit `src/generated/` by hand.** It comes from `manifest/` through `npm run gen`.
- **No real account data.** Never commit a real user id, username, media id, email or
  session, in code, tests, fixtures or commit messages. Use fake ids such as `10000000001`
  or `4000000000000000001`. Public `@instagram` data is the only real data allowed.
- **Respect the layers.** Endpoints depend on the core interfaces, never on a concrete
  adapter. `npm run deps` checks this.

Formatting, lint, naming and boundaries are enforced by the tools, so there is no style
guide to read beyond [CONVENTIONS.md](CONVENTIONS.md).

## Commits and pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:` and so on), with a header of at most 72 characters.
- Pull requests are squash-merged, so the pull request title becomes the commit on `main`
  and has to follow the same format. CI checks it.
- Keep a pull request to one change. Small diffs get reviewed faster.
- If the change is visible to users, add a line under an `Unreleased` heading at the top
  of [CHANGELOG.md](CHANGELOG.md).

## Moving to a new app build

The README's Development section lists the steps. The report from `npm run app-build` goes
in the pull request description.
