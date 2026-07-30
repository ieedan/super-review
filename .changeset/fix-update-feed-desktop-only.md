---
'@super-review/web': patch
---

fix: resolve the update feed and download links from desktop releases only

`releases/latest` returns the newest release of any kind in the releases repo.
Once changesets started publishing the `super-review` CLI, its release
(`super-review@<version>`) outranked the desktop one — and it carries no
installers or `latest*.yml`, so the updater reported "Couldn't check for
updates" and the download buttons 404'd. Both now scan recent releases for the
newest `v<semver>`-tagged one that actually has the requested asset.
