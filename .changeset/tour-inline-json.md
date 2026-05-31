---
"@super-review/desktop": patch
---

Require `--tour` to be passed as inline JSON.

The `session save --tour` flag no longer accepts a path to a JSON file (or `-` for stdin); the tour document is now passed directly as the argument's value. This trims an unnecessary file-read round-trip and the associated error cases. For a large tour, expand the JSON inline via the shell (e.g. `--tour "$(cat tour.json)"`).
