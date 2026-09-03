---
'@super-review/core': patch
---

perf(commit): batch git add operations for massive performance improvement

Replaces per-file git add invocations with batched `git add` calls, reducing commit time for large changesets from tens of seconds to tens of milliseconds. Extracts staging logic into a reusable `stagePathsBatched()` function that batches paths in chunks while maintaining per-path fallback for edge cases (gitignore rules, pathspec mismatches, symlinks beyond symlinks). Applies to both full commits and partial (hunk-selection) commits.
