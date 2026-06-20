---
'@super-review/desktop': minor
'@super-review/core': minor
---

feat: in-app feedback flow (Cmd/Ctrl+Shift+F)

Add a feedback dialog for reporting bugs, requesting features, or sharing
thoughts. It supports a Markdown description and screenshot/screen-recording
attachments (uploaded to R2 via a small Cloudflare Worker, with size limits), and
files a labeled GitHub issue on the super-review repo. The error toast gains a
one-click "Report" button that opens the same flow pre-filled with the error
details. A new repository workflow triages incoming feedback issues with Claude
Code or Cursor — categorizing features and opening fix PRs for bugs.
