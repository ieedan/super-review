---
'@super-review/core': patch
'@super-review/desktop': patch
'@super-review/ui': patch
---

feat: show an in-app notice above the commit box while a new app version downloads ("Installing update…") and once it's staged ("Update ready"), with a Restart to update button that installs it. The main process (electron-updater) already downloaded updates from GitHub Releases in the background; this surfaces that progress and lets the user install on demand instead of only on the next quit.
