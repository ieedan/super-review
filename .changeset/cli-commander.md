---
'super-review': patch
---

Parse the CLI's commands and flags with `commander` instead of a hand-rolled
argv parser. This gives consistent, auto-generated `--help` menus at every level
(`super-review`, `super-review session`, `super-review session save/clear`),
a `--version` flag, plus unknown-command/flag detection with suggestions. The
command and flag signature is unchanged — `session save` and `session clear`
and all their options behave exactly as before.
