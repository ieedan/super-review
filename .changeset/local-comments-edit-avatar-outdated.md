---
'@super-review/desktop': patch
---

Local review comments (the Unstaged/branch/session views) now match the PR comment view. You can edit your own comment's body inline with an "Edit" pencil action; comments show the author's GitHub avatar (with an initialed placeholder when you're not signed in); and a comment whose anchored line has dropped out of the diff is flagged "Outdated" in the comment and the Comments panel. Copying a comment as a prompt now includes its id and a `super-review comment resolve <id>` hint, so an agent knows exactly which comment to resolve.
