---
name: loop-tasks
description: Work through the branch's Super Review task list end to end - use the super-review CLI to read the open tasks, resolve each one in code, check it off, and keep looping until the whole list is done.
metadata:
  version: 1
---

The branch carries a task list: a per-branch checklist stored in the repo under
`.super-review/tasks/` and committed, so it travels with the branch. Your job is
to drive that list to empty - resolve every open task, checking each one off as
you go, and don't stop while open tasks remain.

The important idea is the loop. The list is not a fixed snapshot you read once: a
human can add tasks while you work, and you'll often break a big task into
subtasks yourself. So the exit condition isn't "I finished the tasks I saw at the
start" - it's "a fresh `task list` shows nothing left open." Re-read the list
after every pass.

Follow and complete the following steps:

- [ ] [#1](#1-read-the-open-tasks)
- [ ] [#2](#2-plan-the-work)
- [ ] [#3](#3-resolve-each-task)
- [ ] [#4](#4-loop-until-the-list-is-empty)

# 1. Read the open tasks

```sh
npx super-review task list # tasks on the current branch; [ ] is open, [x] is done
```

Each task prints its id, title, and any notes; subtasks are indented under their
parent. Read the notes - they carry the acceptance criteria and context the
author wanted you to have.

If the output is `no tasks on branch "<name>"`, or every task is already `[x]`,
there is nothing to do. Say so and stop.

Add `--json` if you want the raw records to reason over (ids, `done`, `notes`,
`parentId`) instead of the human-readable listing.

# 2. Plan the work

Before touching code, turn the open tasks into a plan:

- Read each open task and confirm it's still valid. A task may already be handled
  by code on the branch, or made moot by a later change. If a task is outdated or
  no longer makes sense, don't silently skip it - surface it to the user and ask,
  or leave a note explaining why (`task edit <id> --notes "..."`) before deciding.
- A task title is a summary, not the full spec. Treat it as pointing at a piece of
  intended work and figure out everything that work actually entails across the
  changed files. If a task is really several independent pieces, break it into
  subtasks so each piece is tracked and checked off on its own:

  ```sh
  npx super-review task add "<subtask title>" --parent <id> --harness claude-code
  ```

  Subtasks nest one level only. Checking off the parent doesn't check off its
  subtasks, so resolve the subtasks first, then the parent.

> [!TIP]
> Independent tasks (or groups) can be resolved concurrently. If you can spin up
> subagents, hand each one a task or group and have it check its own tasks off
> with `task done`. Keep dependent work in order.

# 3. Resolve each task

For each open task, do the actual work in code, then verify it before you check
anything off. A task is "done" when the change exists and you've confirmed it
behaves (built, typechecked, tested, or exercised - whatever fits the change),
not when you've merely written something plausible. Checking off a task you
haven't verified defeats the point of the list.

Once a task is genuinely resolved:

```sh
npx super-review task done <id> --harness claude-code # check it off, recording who did it
```

Pass `--harness claude-code` so the list records that you acted (the harness logo
shows in the app). The harness options are `claude-code`, `cursor`, `codex`,
`opencode`, `copilot`, `other` - use `claude-code`.

If you genuinely cannot complete a task (blocked, ambiguous, needs a human
decision), don't check it off. Leave a note on it explaining what's blocking and
raise it with the user:

```sh
npx super-review task edit <id> --notes "<what's blocking / what you need>"
```

# 4. Loop until the list is empty

This is the core of the skill. After each pass of resolving-and-checking-off, run
`task list` again:

```sh
npx super-review task list
```

- If open (`[ ]`) tasks remain - including any a human added while you worked, or
  subtasks you created in step 2 - go back to step 3 and resolve them.
- Keep looping until a fresh `task list` shows every task `[x]` (or reports no
  tasks). Only then are you done.

When the list is finally clear, give the user a short summary: what you resolved,
anything you left open with the reason, and anything you'd want a reviewer to
scrutinize.
