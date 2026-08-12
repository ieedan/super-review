---
'@super-review/ui': minor
---

feat: Prefetch and fast-lane render for "mark seen" advance

The mark-seen advance now warms both the diff cache and syntax highlighting before the jump,
so the target file renders immediately from cache instead of showing "Loading diff…" while
waiting on a git IPC round trip. The diff view's fast-lane render catches prefetched content
and paints it synchronously before pinning to it, while new highlight cache infrastructure
ensures the first paint comes up highlighted rather than plain text.

Tests cover the whole flow: prediction accuracy, prefetch deduplication across rapid scrolls,
render timing on arrival (especially for collapsed targets), and end-to-end highlighting.
