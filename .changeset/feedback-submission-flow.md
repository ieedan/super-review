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

Markdown composers (PR review comments, changeset summaries, the feedback
dialog) now accept pasted/dropped images: GitHub-bound text uploads to the R2
broker, while local-only review comments save the image to the repo's
git-ignored `.super-review/attachments` dir and reference it through a privileged
`sr-asset://` URL — so local comments stay offline and free.
