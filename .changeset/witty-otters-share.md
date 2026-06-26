---
'@super-review/core': patch
'super-review': patch
---

fix: `comment list --pr` now matches the desktop app's GitHub account per repo. It finds the app's config across dev and packaged installs, and honors the app's per-repo account pin, so a private repo owned by a secondary (non-default) account resolves instead of 404ing.
