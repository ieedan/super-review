---
'@super-review/desktop': patch
'@super-review/core': patch
'@super-review/cli': patch
---

Extract the session-authoring CLI into a standalone `@super-review/cli` package, backed by a shared `@super-review/core` (the pure-node session + git layer). The desktop app no longer bundles the CLI or exposes the `super-review` bin — it consumes `@super-review/core` for its session/diff read paths. Behavior is unchanged; this is a structural refactor that makes the CLI independently buildable and publishable.
