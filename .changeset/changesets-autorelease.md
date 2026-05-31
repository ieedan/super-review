---
"@super-review/desktop": patch
---

Switch releases to a changesets-driven autorelease workflow. Versioning and the
changelog are now produced from `.changeset/*` files, and merging the generated
"Version Packages" PR builds and publishes the GitHub Release automatically.
