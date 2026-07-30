---
'@super-review/core': patch
'@super-review/desktop': patch
'@super-review/ui': patch
---

fix: keep local comments visible on the Branch tab after a PR is opened

Opening a PR for a branch used to hide every local comment written before it
existed. Two causes, both fixed: the Branch tab swapped its comment source over
to GitHub wholesale, and the base half of the `branch:<base>..<head>` storage key
gets repinned to `pr/<n>/base` once a PR exists, so the lookup no longer matched
the rows. Local threads now render alongside the PR's own, and branch comments
are looked up by head ref (matching what the CLI already did).
