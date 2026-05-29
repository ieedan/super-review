---
name: document-session
description: Document the changes you made as a super-review session when you finish (or reach a checkpoint in) a coding task, so a human can review them in the super-review desktop app. Use after completing edits in a repo that the user reviews with super-review.
---

# Document a super-review session

A **session** is a frozen, agent-documented snapshot of the changes you made:
a name, a description, the harness that produced them, and the diff of every
changed file. Recording one lets a reviewer open your run in isolation in the
super-review desktop app instead of sifting through one undifferentiated pile of
unstaged changes.

## When to run

Run this when you finish a task, or at a meaningful checkpoint. It's safe to run
repeatedly — re-running with the same `--key` **updates** the existing session
with your latest changes rather than creating a duplicate.

## How

From the repository root, run the super-review CLI:

```bash
super-review session save \
  --key "<your conversation/session id>" \
  --name "<concise summary of what you did>" \
  --description "<what changed and why>" \
  --harness <harness> \
  [--harness-url "<resume/permalink to this run>"]
```

If the `super-review` command isn't on `PATH`, invoke the built CLI directly:

```bash
node /path/to/super-review/apps/desktop/out/main/cli.js session save ...
```

### Arguments

- `--key` — **Always pass the same stable id for the same conversation** (your
  harness's conversation/run id). This is what makes re-runs update the same
  session instead of piling up duplicates.
- `--name`, `--description` — Required the first time you save a session.
  Optional on later updates (omitting them keeps the previous values).
- `--harness` — One of: `claude-code`, `cursor`, `codex`, `opencode`,
  `copilot`, `other`. Drives the logo shown on the session card. Use
  `--harness-label "<name>"` with `--harness other` to label an unlisted tool.
- `--harness-url` — Optional. A link back to this run (a resume URL or
  permalink). When present, the session card shows an "open in harness" button.
- `--cwd` — Optional. The repo path; defaults to the current directory.

The snapshot is captured from the **current working-tree changes**, so make sure
your edits are saved (they don't need to be committed) before running.

## Notes

- The session is a frozen snapshot: it keeps the diff as it was at save time,
  even if the working tree changes afterward. Re-run `save` to refresh it.
- The CLI exits non-zero (with a message) if there are no changes to capture or
  the directory isn't a git repository.
