---
'@super-review/desktop': patch
---

Populate GitHub Release notes from the changelog. The `publish-release` job now extracts the current version's section from `CHANGELOG.md` (notes + PR links) and sets it as the release body when flipping the draft live, instead of leaving it blank.
