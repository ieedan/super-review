---
'@super-review/desktop': patch
'@super-review/ui': patch
---

fix: count local comments in the file list when a PR is open

The per-file comment count in the sidebar zeroed out local comments in a PR
context, so on the Branch tab with an open PR a file's local threads rendered in
the diff but were missing from its count. Same mutually-exclusive gate that hid
the comments themselves, in one more spot.
