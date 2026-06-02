---
"@super-review/desktop": minor
---

Review any branch or pull request read-only without checking it out.

Right-click a branch — or a pull request, in the picker's Pull Requests tab — and choose **View Read-Only** to review its diff without touching the working tree, so an agent (or your own in-progress work) on another branch is never disrupted. A PR shows the same diff a checkout would (its head vs. the default branch), but nothing is checked out. The picker labels whatever's on screen; a pill in the top bar surfaces the branch that's actually checked out and clicks back to it. The Unstaged tab is hidden while reviewing read-only, since there's no working tree to commit against.
