---
"@super-review/desktop": minor
"@super-review/core": minor
---

Offer to fork a repository when you don't have write access to its GitHub remote.
A banner in the commit box explains the missing access, and committing or pushing
(or clicking the banner link) prompts to create a fork — matching GitHub Desktop.
Confirming creates the fork under your account, repoints `origin` at it, and
resumes the commit/push against your fork. You choose how to use the fork — "to
contribute to the parent project" (keeps the original as `upstream`, so the PR
list and "Create PR" target the parent) or "for my own purposes" (works the fork
standalone). "Create PR" on a fork now opens the compare against the right repo.
