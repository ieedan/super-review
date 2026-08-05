---
'@super-review/desktop': minor
'@super-review/ui': minor
---

feat: test regex literals inline in the diff

Hovering a regex literal in a JS/TS diff now hints that it can be tested, and
clicking it opens a small popup: type a test string and see live whether it
matches, with the matched runs highlighted in place and the character range
called out. A global literal highlights every match; a literal that does not
compile shows the engine's error instead, which makes a broken pattern obvious
during review rather than after it ships.

Detection is a real scanner, not a search for slashes: division, comments,
strings and template text are left alone, and a literal split across several
syntax-highlighted tokens still resolves as one.
