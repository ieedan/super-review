---
'@super-review/desktop': patch
---

fix: adding a local review comment failed with "An object could not be cloned"

A new comment's content anchor was read straight from the reactive composer state and sent to the main process as a Svelte proxy, which Electron's IPC can't copy. The anchor is now snapshotted to a plain object first, for both new comments and replies.
