---
"@super-review/desktop": minor
---

Review any branch or pull request read-only without checking it out.

Right-click a branch — or a pull request, in the picker's Pull Requests tab — and choose **View Read-Only** to review its diff without touching the working tree, so an agent (or your own in-progress work) on another branch is never disrupted. A PR shows the same diff a checkout would (its head vs. the default branch), but nothing is checked out. The picker labels whatever's on screen; a pill in the top bar surfaces the branch that's actually checked out and clicks back to it.

While reviewing read-only the header follows the view rather than the checkout: the Unstaged tab is hidden (no working tree to commit against), the PR button opens the *viewed* branch/PR's pull request, Refresh re-reads the viewed diff (no "Pull"), and the open-in-editor/terminal buttons are hidden (they'd open the checked-out branch's files). Branch and PR diffs also now compare against `origin/<default>` rather than the local default branch, so they match GitHub even when your local default is behind the remote.
