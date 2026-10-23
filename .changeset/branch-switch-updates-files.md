---
'@super-review/desktop': patch
---

fix: switching branches from the picker on the Branch tab now updates the files in the sidebar

The Branch diff target was worked out before the new branch was known, so the sidebar kept listing the branch you had just left. It is now derived after the branch refresh, and the previous branch's PR is cleared so its base cannot carry over.
