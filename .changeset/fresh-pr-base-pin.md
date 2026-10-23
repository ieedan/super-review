---
'@super-review/desktop': patch
---

fix: the Branch tab no longer lists files that are not part of the PR, and a rejected review comment now explains why

The PR's base branch was pinned once per session and never refreshed, so once the base moved the Branch diff was computed against an old snapshot and could include files GitHub does not count in the PR. The pin is now re-fetched (at most once a minute) and the diff reloads when the base changes. GitHub also reports an unpushed or unknown commit on the bare `commit_id` field, which was not recognized, so the raw API error leaked through. It now shows the "push your branch" message instead.
