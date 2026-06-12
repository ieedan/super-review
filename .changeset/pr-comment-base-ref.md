---
"@super-review/desktop": patch
---

Fix PR review comments failing with "could not be resolved". A branch with a PR is now diffed against the PR's actual base ref (`pr/<n>/base`, fetched from the PR's own base repo) instead of the local default branch, so the diff matches GitHub's PR and comments anchor to lines that are genuinely part of it. Also force-fetch the PR head snapshot, anchor comments to the reviewed commit, and surface a clearer message when a line truly isn't in the current diff.
