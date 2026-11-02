---
'@super-review/core': patch
---

fix: a branch checked out from a fork now picks up the contributor's new commits

The background fetch only refreshed `origin`, so a branch tracking a fork's remote (what checking out a fork PR creates) froze at the commit you first checked out. The behind count never appeared and the Branch tab kept showing the old code. The fetch now refreshes the remote the current branch tracks as well, and a fork that can't be reached no longer fails the origin fetch.
