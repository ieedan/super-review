---
'@super-review/desktop': patch
---

Remove local review comments that a commit orphans. When you commit a file, any working-tree comment pinned to it is removed once the file has no remaining changes (the diff it anchored to is gone for good). Partially-committed files keep their comments, since those may still anchor to what's left.
