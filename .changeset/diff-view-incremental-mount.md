---
'@super-review/desktop': patch
---

fix: stop the diff view from freezing on diffs with thousands of changed files. The scroll layout mounted one `DiffFileSection` per changed file up front — 7000+ heavy sections (Pierre imports, derived/effect graphs, observer registrations) mounted synchronously on load. It now mounts an initial window and grows it as you scroll toward the end (a bottom sentinel) or jump to a file past it from the sidebar, so the initial render stays cheap regardless of file count.
