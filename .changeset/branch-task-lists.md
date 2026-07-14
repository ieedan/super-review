---
'super-review': minor
'@super-review/core': minor
'@super-review/ui': minor
---

feat: branch task lists

Add a per-branch task list for tracking work before opening a pull request. Tasks
live under `.super-review/tasks/` and are committed with the branch. Manage them
from the new Tasks tab in the right sidebar (Cmd/Ctrl+T) or the `super-review task`
CLI (`add` / `list` / `done` / `undone` / `edit` / `remove` / `clear`). Tasks are
ordered (new tasks append to the bottom) and can be reordered by dragging their
grab handle. Tasks can have subtasks (one level), added from the row's overflow menu
or `task add --parent <id>`. A task can be put on hold from the overflow menu (or
`task hold`), which dims it as upcoming-but-not-ready without marking it done. Each
task records who created it and who checked it off, including an agent's
harness, so the UI can show the same logo or avatar it uses for review comments. The
tasks file also renders as a checklist card in the diff view instead of raw JSON.
