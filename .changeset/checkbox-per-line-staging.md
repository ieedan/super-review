---
"@super-review/desktop": minor
---

Add line- and hunk-level staging (checkbox-per-line) to the Unstaged tab.

Previously a commit could only include or exclude whole files. You can now carve up a file: every changed line in a modified file's diff has a checkbox in the gutter, and each hunk has a toggle, so you can commit just the lines you want and leave the rest as working-tree changes — like GitHub Desktop. The sidebar file checkbox becomes tri-state (checked / partial / unchecked) to reflect a partial selection, and committing a subset builds a reduced patch that's applied through a scratch index, leaving your real index and the unselected changes untouched. Whole-file staging is unchanged for added/untracked, deleted, renamed and binary files.
