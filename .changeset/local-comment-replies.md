---
'super-review': patch
'@super-review/ui': patch
'@super-review/core': patch
---

feat: reply to local review comments

Local review comments can now hold threaded replies. Agents reply from the CLI
with `super-review comment reply <id> <body>` (authored via `--harness`), and
humans reply from the desktop with the same Write/Preview composer used for new
comments. Replies inherit the thread root's anchor, resolution stays
thread-level (on the root), and the sidebar/file-count badges count threads, not
individual replies. `comment list` now groups replies under their root and
`--unresolved` filters by the root's state.

A new "Copy thread" control copies a whole thread (root + replies) as markdown
for an agent, on both PR and local comments. The resolve toggle now lives in a
thread-level action bar below the conversation on both PR and local comments
(previously local put it in the comment header), so the two are consistent.
