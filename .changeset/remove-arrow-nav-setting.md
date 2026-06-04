---
'@super-review/desktop': patch
---

Remove the confusing "open on arrow / open on enter" arrow-key navigation setting. It never affected how diffs were displayed, so it couldn't deliver a one-file-at-a-time view. Arrowing the sidebar now always opens the focused file, and the existing "Diff layout" setting (Scrollable vs. One at a time) is the single control for whether you scroll through every file or review one at a time.
