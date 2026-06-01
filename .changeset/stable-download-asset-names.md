---
'@super-review/desktop': patch
---

Publish release artifacts under stable, version-less filenames
(`Super-Review-mac-arm64.dmg`, `Super-Review-win-x64.exe`) so the download site
can link straight to `releases/latest/download/<name>` and always serve the
newest build.
