---
'@super-review/desktop': patch
'super-review': patch
---

feat: pin local review comments to their code so they follow edits

Local comments used to be stored as a bare line number, so lines added or removed above them left them pointing at the wrong code. A comment now also keeps the commented text plus a few lines of context, and is re-located in the current file: it follows the code when lines shift, survives small edits to the line, and is marked outdated only when the code is gone. The comments sidebar, copy-prompts and `super-review comment list` (which now prints `(was L4)` for a moved comment and `outdated` for a gone one) all use the resolved line. Comments made before this keep their stored line.

Also fixes the same repo being filed under several spellings of its path (`GitHub` vs `github`, symlinks), which hid the app's comments from the CLI and the reverse. Existing comments are merged onto one key on first launch.
