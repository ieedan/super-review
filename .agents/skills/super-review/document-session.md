# Document a Super Review session

A **session** is a guided **tour** of the changes you made, written for a human
reviewer. You group related files into ordered **steps**, each with a short
explanation, so the reviewer reads your change as a narrative instead of an
alphabetical pile of diffs. They open it in the Super Review desktop app and
walk the tour step by step, with your commentary above each group of diffs.

## How to author a tour

1. Make sure your edits are saved. By default the diff is captured from the
   current working tree, so they don't need to be committed. To document changes
   you've **already committed** on a branch, add `--committed` (see
   "Documenting committed changes" below).
2. Pass the tour as inline JSON to `--tour`:

```bash
npx super-review session save --key "<your conversation/run id>" --tour '{
	"name": "Short title for the whole change",
	"description": "One or two sentences of overview.",
	"harness": "claude-code",
	"harnessUrl": "<optional resume/permalink to this run>",
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
- `side` - `"new"` (added/current lines, the default) or `"old"` (the original).
- `body` - Markdown commentary.

### Writing a good tour

- **Group by idea, not by folder.** Files that change together for one reason
  belong in one step.
- **Order for reading.** Lead with the step that makes the rest make sense
  (often the data model / types); end with tests or cleanup.
- **Explain the why.** The diff already shows _what_ changed - the body should
  say _why_. Similarly don't say _what_ the code does say _why_ it does it.
- **List files in reading order** within a step.
- **List every file you changed, and only those.** When you pass a tour, the
  session captures _only_ the files the tour references — that's the point: the
  reviewer sees the exact change you made, not whatever else is sitting in the
  working tree. So place every file you touched in some step. A changed file you
  leave out is _not_ captured; an unchanged file you list is dropped (the CLI
  warns about it).

### Arguments

- `--key` - **Always pass the same stable id for the same conversation** (your
  harness's conversation/run id). This is what makes re-runs update the same
  session instead of piling up duplicates.
- `--tour <json>` - the tour as inline JSON, passed directly as the argument.
- `--name`, `--description` - the overview. Required on first save unless the
  tour supplies them. Flags override the tour's values.
- `--harness` - one of: `claude-code`, `cursor`, `codex`, `opencode`,
  `copilot`, `other`. Drives the logo on the session card. Use
  `--harness-label "<name>"` with `--harness other` to label an unlisted tool.
- `--harness-url` - Optional. A link back to this run (resume URL or permalink).
- `--cwd` - Optional. The repo path; defaults to the current directory.

A quick flat session (no tour) still works: pass `--name`/`--description`
without `--tour`, and every changed file is captured ungrouped (no scoping —
this includes any unrelated working-tree edits, so prefer a tour when you want
only your own changes).

### Documenting committed changes

By default `save` captures the working tree, so it sees nothing once you've
committed. To document a change **after committing it** (e.g. "document the
changes on this branch"), pass `--committed`: it captures this branch diffed
against its base — the auto-detected default branch (`main`/`master`), the same
`base...head` diff the desktop app shows for a branch.

```bash
super-review session save --committed --key "<run id>" --tour '{ ... }'
```

- `--committed` - capture this branch's committed diff instead of the working tree.
- `--base <ref>` - override the base to diff against (implies `--committed`).
- `--head <ref>` - override the head (implies `--committed`); defaults to the
  current branch.

Tour `files`/`callouts` work the same way - they just refer to files in the
committed diff instead of the working tree.

Once you've documented the fixes for a batch of review comments, mark those
comments resolved and link them back to this session — see
[resolve-comments.md](resolve-comments.md).
