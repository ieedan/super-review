---
"@super-review/desktop": minor
---

Add a "Publish to GitHub" flow for repositories with no remote.

When the active repository has no `origin` remote, the top-bar primary action now shows **Publish** instead of nothing — fixing the dead end where a freshly created/committed repo offered no way to push. Clicking it opens a GitHub-Desktop-style **Publish Repository** dialog (Name defaulting to the folder, Description, a "Keep this code private" checkbox, and an Organization dropdown). Publishing makes the initial commit if the repo has none yet (so a freshly seeded README is committed rather than failing the push), creates the repository on GitHub via the signed-in account (under the chosen org or the account itself), wires it up as `origin`, and pushes the current branch — using the system git credential helper, never writing a token into the repo config. The flow is retryable: if the GitHub repo already exists (e.g. a prior attempt created it but the push failed), it's reused instead of erroring.
