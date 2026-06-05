---
name: document-session
description: Document changes you made in your session as a Super Review slice (a live, content-free guided tour) to make them easier for users to parse and understand.
---

# Document a Super Review slice

A **slice** is a guided **tour** of the changes you made, written for a human
reviewer. You group related files into ordered **steps**, each with a short
explanation, so the reviewer reads your change as a narrative instead of an
alphabetical pile of diffs. They open it in the Super Review desktop app and
walk the tour step by step, with your commentary above each group of diffs.

A slice stores **no code** — only where to look (paths + line callouts) and what
to say. The diff is always recomputed live from your branch's changes (committed
**and** uncommitted, versus the branch's fork point) and filtered to the slice's
files, so a slice never goes stale or drifts: callouts are auto-anchored to the
line text and follow edits, or surface as "outdated" if the line is gone.

> `session save` still works as a deprecated alias for `slice save` (one
> release), so older scripts keep running. Prefer `slice save`.

## How to author a tour

1. Make your edits — they don't need to be committed (a slice always renders the
   branch's changes, committed or not, against its fork point).
2. Pass the tour as inline JSON to `--tour`:

```bash
npx super-review slice save --key "<your conversation/run id>" --tour '{
	"title": "Short title for the whole change",
	"description": "One or two sentences of overview.",
	"harness": "claude-code",
	"steps": [
		{
			"title": "Data model",
			"body": "What this group establishes and why. Markdown is supported - **bold**, lists, and `code` all render.",
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

### Callouts: point at specific lines

A step's `callouts` pin commentary to a **line range** inside one of its files,
rendered as a note right at that spot in the diff. Each callout has:

- `file` - one of the step's files.
- `startLine`, `endLine` - 1-based inclusive range (omit `endLine` for one line).
  These are **hints**: they're auto-fingerprinted against the current diff and
  re-resolved on every render, so they follow drift instead of pointing at the
  wrong line.
- `side` - `"new"` (added/current lines, the default) or `"old"` (the original).
- `body` - Markdown commentary.

### Writing a good tour

- **Group by idea, not by folder.** Files that change together for one reason
  belong in one step.
- **Order for reading.** Lead with the step that makes the rest make sense
  (often the data model / types); end with tests or cleanup.
- **Explain the why.** The diff already shows _what_ changed - the body should
  say _why_.
- **List files in reading order** within a step.
- Any changed file you don't place in a step still shows, grouped under
  **"Other changes"** at the end — nothing is hidden, but anything worth the
  reviewer's attention should be in a step.

### Arguments

- `--key` - **Always pass the same stable id for the same conversation** (your
  harness's conversation/run id). This is what makes re-runs update the same
  slice instead of piling up duplicates.
- `--tour <json>` - the tour as inline JSON, passed directly as the argument.
- `--title`, `--description` - the overview. Required on first save unless the
  tour supplies them. Flags override the tour's values.
- `--harness` - one of: `claude-code`, `cursor`, `codex`, `opencode`,
  `copilot`, `other`. Drives the logo on the slice card.
- `--author <name>` - your display name (defaults to the harness).
- `--files <a,b,c>` - scope the slice to just these paths (defaults to every file
  the branch changed). List files in reading order.
- `--cwd` - Optional. The repo path; defaults to the current directory.

A quick flat slice (no tour) still works: pass `--title`/`--description` without
`--tour`, and every changed file is listed ungrouped.

### Migrating old sessions

If a repo still has legacy `.super-review/sessions/*.json` manifests, convert
them to content-free slices with `super-review slice migrate` (originals are
moved aside, not deleted).
