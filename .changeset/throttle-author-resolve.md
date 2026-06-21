---
'@super-review/desktop': patch
---

fix: stop the History tab from freezing the app on large repos. Resolving commit-author avatars fired one GitHub `getCommit` request per distinct author all at once; on a branch with dozens of authors the burst saturated the main process and tripped GitHub's secondary rate limit, stalling IPC. The probes now run through a small concurrency pool so they stay background work and the UI stays responsive.
