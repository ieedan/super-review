---
'@super-review/core': patch
'@super-review/desktop': patch
'@super-review/ui': patch
---

feat: Clone a repository by picking it from your own GitHub repositories

The clone flow now opens on a picker listing the repositories the signed-in account can reach (its own, its organizations', and ones shared with it), filterable (with the matched text highlighted) and grouped by owner, with a switcher for cloning from a second account. Pasting a Git URL moves to its own tab, and the destination folder is chosen in the dialog instead of a separate native picker. Listings are cached per account in the main process and prefetched as soon as the Add Repository dialog opens, so the picker is populated the moment you reach it; a stale cache still answers instantly and revalidates behind the dialog. The fetch itself pages in parallel off the `Link` header rather than walking one round-trip at a time. Repos already cloned on this machine are badged "local", and picking a destination that already holds files blocks the clone with git's own reason instead of failing after the fact — when what's there is a repository, the dialog offers to add it rather than clone a second copy. Cloning into a folder that exists but is empty now works, matching git.

A clone made from the picker authenticates as (and is pinned to) the account it was picked from, so a private repo on a non-default account clones and keeps fetching correctly.
