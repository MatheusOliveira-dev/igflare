# New app builds

igflare presents itself as one build of the Instagram app for Android. The newer screens of
the app are served by persisted GraphQL queries, and each build can change their ids. This
page is for whoever maintains igflare, or a fork of it.

## Where the ids live

`manifest/persisted-queries.json` lists every query igflare sends: its name, the operation
the app calls it, and its id for the current build. `npm run gen` turns it into code, and CI
checks that the two match.

## Moving to a new build

Download the new build's `base.apk`, then:

```sh
# Report which ids changed, which stayed, and which queries the build no longer ships.
npm run app-build -- path/to/base.apk --build 455.0.0.12.34

# Apply the changes to the manifest, and generate the code.
npm run app-build -- path/to/base.apk --build 455.0.0.12.34 --write
npm run gen

# Check the live service with a test account.
IGFLARE_SESSION=session.json npm run live-check -- --professional
```

The device profile's app version and version code change by hand in the same commit.

A query reported as **missing** needs a look at the APK: the screen may have moved to
another query. A **pinned** query is kept as it is on purpose, and its `note` in the
manifest says why.

## The live check

`npm run live-check` runs a read-only pass against Instagram with a saved session: profile,
feeds, search, direct inbox, stories and, with `--professional`, insights. Nothing is
posted, liked or sent. `--cycles N` repeats the pass with pauses, to see whether a long
session starts getting refused.
