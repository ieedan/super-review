---
"@super-review/desktop": minor
---

Offer to switch back to the default branch when a branch's PR merges.

When you're on a non-default branch and its PR is observed going from unmerged → merged, a dialog asks whether to switch the working tree back to the default branch, do nothing, or remember either choice via an "Always do this automatically" checkbox. After switching, a second dialog offers to remove the now-merged branch locally (remote untouched), with an "Always remove merged branches locally" checkbox. Both prompts only fire on a live merge transition we observed — never when navigating to an already-merged PR. Behavior settings expose the matching controls: a three-way "Merged branches" choice (Ask each time / Switch back / Do nothing) and the auto-remove toggle.
