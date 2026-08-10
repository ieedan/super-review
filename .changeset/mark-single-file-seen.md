---
'@super-review/core': minor
'@super-review/desktop': minor
'@super-review/ui': minor
---

feat: mark a single file seen from its right-click menu

Right-clicking one file offered copy/reveal/open and nothing about review state.
Marking several at once has always been there, so the omission read as a rule
about single files rather than the gap it was. The single-file menu now carries
one item that flips the file's mark, labelled for the direction it moves: "Mark
as Seen", or "Mark as Unseen" on a file already cleared.

It matters most on the Unstaged tab, where the row's checkbox is the
commit-inclusion one and the seen state isn't surfaced at all. Before this the
only way to mark a single unstaged file seen was to open it and use the diff
header's button or the hotkey; now the file list can do it too.

Both menus mark exactly the set they name, so the two actions behind them are no
longer specific to a selection.
