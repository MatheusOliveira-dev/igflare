# Deferred

Work intentionally postponed. Each item names the trigger that should bring it back.
Read this file before `npm publish` or cutting a release tag.

| Item                                                                                                              | Trigger                                                           |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| npm publish provenance (`--provenance` in the release workflow; the release script refuses to publish without it) | First publish                                                     |
| Typedoc + a check that public API has doc comments                                                                | First stable release tag (`v*`)                                   |
| Mutation testing wired into CI as a gate                                                                          | When the critical modules are large enough to warrant the CI time |
| Contributor setup: `CONTRIBUTING.md`, PR/issue templates, "good first issue" labels                               | First external contributor                                        |
| Branch protection on `main` and CODEOWNERS enforcement                                                            | When the repo is pushed to GitHub                                 |

These are config/docs with no retrofit cost, which is why they can wait. The expensive
guards (types, tests, generation, boundaries) are already in place.
