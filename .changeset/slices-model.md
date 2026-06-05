---
'@super-review/core': minor
'super-review': minor
'@super-review/desktop': patch
---

feat: slices — the content-free, live-rendering successor to sessions

Rebuilds the review model so it stores no code, only where to look and what to
say. A **slice** persists paths + narrative + drift-following anchors and never
any diff content; the diff is always recomputed live from the branch's changes
(committed and uncommitted, versus the fork point) and filtered to the slice's
files, so it never goes stale.

- Anchor engine (`anchor.ts`): fingerprint-based anchors that follow line drift
  or surface as "outdated", usable in both node and the renderer.
- Union diff mode in git-service: merge-base(base, HEAD) → working tree.
- Slice model + store + capture (content-free), with read-from-ref support.
- CLI `slice save`/`clear`/`migrate`, with `session` kept as a deprecated alias.
- Comments gain a fingerprint anchor + derived GitHub-postability and a
  posted-binding column.
- Desktop IPC/preload render slices live (filtered union/branch diff).
- One-time `slice migrate` converts legacy frozen sessions, moving originals
  aside.
