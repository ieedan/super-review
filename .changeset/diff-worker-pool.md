---
"@super-review/desktop": patch
---

Render diffs on a @pierre/diffs worker pool so syntax highlighting and diff-AST
generation run off the main thread. Scrolling, typing in comment composers, and
tab switches stay responsive while large diffs paint; diffs show plain text
first and upgrade to highlighted output as the workers finish. If the worker
pool can't start, rendering transparently falls back to the main thread.
