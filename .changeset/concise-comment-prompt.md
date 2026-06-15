---
"@super-review/desktop": patch
---

Simplify the copy-as-prompt text for review comments. Copied comments now read `Review comment at line 240 in `path`:` instead of spelling out "on the new/original side of the diff", with an `(original side)` qualifier kept only for comments on the pre-change side where the line number refers to the old file.
