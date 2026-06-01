---
"@super-review/desktop": minor
---

Offer to switch back to the default branch when a branch's PR merges.

When you're on a non-default branch and its PR is observed going from unmerged → merged, a dialog asks whether to switch the working tree back to the default branch, with an "Always automatically switch back" checkbox. After switching, a second dialog offers to remove the now-merged branch locally (remote untouched), with an "Always remove merged branches locally" checkbox. Both prompts only fire on a live merge transition we observed — never when navigating to an already-merged PR. The two behaviors have matching toggles in Behavior settings so the prompts can be skipped entirely.
