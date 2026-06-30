---
name: document-session
description: Run whenever you reach a checkpoint in a coding task (a feature done, a bug fixed, or a logical unit of work completed) to document the changes you just made as a guided Super Review tour for a human reviewer, using the super-review CLI. Also run when the user asks you to write up, document, record, or update a review session or tour of your changes. Group the diff into ordered steps with commentary so the reviewer reads the change as a narrative instead of an alphabetical pile of diffs.
metadata:
  version: 1
---

# Document a Super Review session

A **session** is a guided **tour** of the changes you made, written for a human
reviewer. You group related files into ordered **steps**, each with a short
explanation, so the reviewer reads your change as a narrative instead of an
alphabetical pile of diffs. They open it in the Super Review desktop app and walk
the tour step by step, with your commentary above each group of diffs. A step can
also carry **callouts** that pin a note to specific lines.

You are documenting the work, not redoing it. Do not modify product code, run
formatters, or run builds while authoring a tour. The only side effect is
creating or updating the session through the CLI.

## Gather context first

1. **Find what changed.** By default the diff is captured from the current
   working tree, so changes do not need to be committed. Inspect the change with
   `git status`, `git diff`, `git diff --staged`, and `git log` to understand the
   full scope. (To document changes you have **already committed** on a branch,
   see "Documenting committed changes" below.)
2. **Understand the intent.** Read the changed files and enough surrounding
   context to explain WHY each change matters, not just WHAT changed. Use
   AGENTS.md / CLAUDE.md to orient yourself in the codebase.
3. **Group changes into a narrative.** Order the steps so a reviewer can follow
   the story: lead with the entry point or core change (often the data model or
   types), then supporting changes (IPC, preload, renderer), then tests and
   cleanup.

## Author the tour

Pass the tour as inline JSON to `--tour`:

```bash
npx super-review session save --harness "<harness>" --key "<your conversation/run id>" --tour '{
	"name": "Short title for the whole change",
	"description": "One or two sentences of overview.",
	"commitTitle": "feat: short conventional-commit line for the change",
	"harness": "claude-code",
	"harnessUrl": "<optional resume/permalink to this run>",
	"steps": [
		{
			"title": "Data model",
			"body": "What this group establishes and why. Markdown is supported: **bold**, lists, and `code` all render.",
			"files": ["src/shared/types.ts", "src/main/store.ts"],
			"callouts": [
				{
					"file": "src/shared/types.ts",
					"startLine": 42,
					"endLine": 48,
					"side": "new",
					"body": "The key bit: this field is what everything downstream keys off."
				}
			]
		},
		{
			"title": "UI",
			"body": "How the new state is surfaced to the user.",
			"files": ["src/components/Thing.svelte"]
		}
	]
}'
```

### Tour fields

Required on the first save (unless supplied via the matching CLI flag):

| Field         | Description                              |
| ------------- | ---------------------------------------- |
| `name`        | Short title for the whole change.        |
| `description` | One or two sentences of overview.        |
| `steps`       | Ordered array of tour stops (see below). |

Optional:

| Field         | Description                                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commitTitle` | Conventional-commit-style line (e.g. `feat: reply to local review comments`). Pre-fills the commit box in the desktop app when the session's files still match the uncommitted working tree. One line only, no body. |
| `harness`     | One of `claude-code`, `cursor`, `codex`, `opencode`, `copilot`, `other`. Drives the logo on the session card.                                                                                                        |
| `harnessUrl`  | Link back to this run (resume URL or permalink).                                                                                                                                                                     |

Each **step** object:

| Field      | Description                                                                           |
| ---------- | ------------------------------------------------------------------------------------- |
| `title`    | Short heading for this group of changes.                                              |
| `body`     | What this group establishes and why. Markdown supported: **bold**, lists, and `code`. |
| `files`    | Repo-relative file paths changed in this step, in reading order.                      |
| `callouts` | Optional. Line-specific notes (see below).                                            |

Each **callout** pins commentary to a line range inside one of the step's files,
rendered as a note at that spot in the diff:

| Field       | Description                                                       |
| ----------- | ----------------------------------------------------------------- |
| `file`      | One of the step's `files`.                                        |
| `startLine` | 1-based start line (inclusive).                                   |
| `endLine`   | Optional. 1-based end line (inclusive). Omit for a single line.   |
| `side`      | `"new"` (added/current lines, the default) or `"old"` (original). |
| `body`      | Markdown commentary.                                              |

## What makes a good tour

- **Group by idea, not by folder.** Files that change together for one reason
  belong in one step.
- **Order for reading.** Lead with the step that makes the rest make sense
  (often the data model or types); end with tests or cleanup. Prefer several
  small, well-placed steps over one giant step.
- **Explain the why.** The diff already shows _what_ changed, so the body should
  say _why_. Do not restate what the code does, explain why it does it.
- **Call out what a reviewer must scrutinize:** risky areas, assumptions, TODOs,
  behavior changes, and pattern-following decisions (for example native context
  menus: types in core, handler in `ipc.ts`, preload bridge, renderer call site).
  Use callouts to pin those notes on the exact line ranges.
- **List files in reading order** within a step.
- **List every file you changed, and only those.** When you pass a tour, the
  session captures _only_ the files the tour references. That is the point: the
  reviewer sees the exact change you made, not whatever else is sitting in the
  working tree. So place every file you touched in some step. A changed file you
  leave out is _not_ captured; an unchanged file you list is dropped (the CLI
  warns about it).
- **Keep prose tight and skimmable**, and write for a human, not a machine. Use
  `code` formatting for anything that references code so `.someFunction` reads as
  `` `.someFunction` ``. Do not over-explain: reviewers want the architecture,
  not every function name. If they want the detail, they can read the code.

## Arguments

- `--key <id>` - **Always pass the same stable id for the same conversation**
  (your harness's conversation/run id). This is what makes re-runs update the same
  session instead of piling up duplicates.
- `--tour <json>` - the tour as inline JSON, passed directly as the argument.
- `--name`, `--description` - the overview. Required on the first save unless the
  tour supplies them. Flags override the tour's values.
- `--commit-title` (or tour `commitTitle`) - a short conventional-commit-style
  line describing the change. The desktop app pre-fills the commit box with it
  when the session's files still match the uncommitted working tree, so the human
  can commit your work without retyping a message. One line only, no body.
- `--harness <name>` - one of `claude-code`, `cursor`, `codex`, `opencode`,
  `copilot`, `other`. Drives the logo on the session card. Set it to the harness
  you are actually running in. Use `--harness-label "<name>"` with
  `--harness other` to label an unlisted tool.
- `--harness-url <url>` - a link back to this run (resume URL or permalink).
- `--cwd <path>` - the repo path; defaults to the current directory.

A quick flat session (no tour) still works: pass `--name` and `--description`
without `--tour`, and every changed file is captured ungrouped. This has no
scoping, so it includes any unrelated working-tree edits. Prefer a tour when you
want only your own changes captured.

## Documenting committed changes

By default `save` captures the working tree, so once you have committed your work
the working tree is empty and `save` sees nothing. To document a change **after
committing it** (for example "document the changes on this branch"), pass
`--committed`: it captures this branch diffed against its base (the auto-detected
default branch, `main` or `master`), the same `base...head` diff the desktop app
shows for a branch.

```bash
npx super-review session save --committed --harness "<harness>" --key "<run id>" --tour '{ ... }'
```

- `--committed` - capture this branch's committed diff instead of the working tree.
- `--base <ref>` - override the base to diff against (implies `--committed`).
- `--head <ref>` - override the head (implies `--committed`); defaults to the
  current branch.

Tour `files` and `callouts` work the same way, they just refer to files in the
committed diff instead of the working tree.

## Before you finish

- Validate the JSON before running, and verify that every file path and line
  reference in the tour exists in the actual diff. Do not invent paths or lines.
- Confirm every changed file appears in at least one step.
- Make sure there are zero em-dashes anywhere in your prose. Em-dashes read as
  machine-written and make sentences harder to parse. Use commas, parentheses,
  or separate sentences instead.
- After running, confirm the CLI reported success and note the `--key` you used
  plus a one-line summary of what the tour covers.

Once you have documented the fixes for a batch of review comments, mark those
comments resolved and link them back to this session's `--key`. See the
**resolve-comments** skill.
