---
'@super-review/desktop': patch
---

chore: bump past 0.1.0, which collides with an existing release

Leaving prerelease mode landed the desktop app on 0.1.0, but a `v0.1.0` release
from 2026-06-02 already exists with published artifacts. The release workflow
gates on `git rev-parse "v$VERSION"`, saw the old tag, and skipped the build —
so 0.1.0 never shipped. Moving to 0.1.1 releases normally without rewriting
published history.
