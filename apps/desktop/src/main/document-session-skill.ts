// The bundled `document-session` skill that the "Install skill" action drops
// into a review repo. This is the canonical copy shipped inside the app, so it
// works in a packaged build without depending on any file on disk.
//
// Keep this in sync with `.claude/skills/document-session/SKILL.md` at the repo
// root — that copy is this project dogfooding its own skill; this one is what
// gets installed into the repos people review. (It is generated from that file.)

// Where a skill lives inside a repo. Agents (Claude Code et al.) discover a
// skill by the presence of `<dir>/SKILL.md`, so this path is both what we
// check for (detection) and what we write (install).
export const DOCUMENT_SESSION_SKILL_DIR = '.claude/skills/document-session';
export const DOCUMENT_SESSION_SKILL_FILE = `${DOCUMENT_SESSION_SKILL_DIR}/SKILL.md`;

export const DOCUMENT_SESSION_SKILL = `---
name: document-session
description: Document the changes you made as a guided super-review session — a tour that groups related files into explained steps — when you finish (or reach a checkpoint in) a coding task, so a human can review them in the super-review desktop app. Use after completing edits in a repo that the user reviews with super-review.
---

# Document a super-review session

A **session** is a guided **tour** of the changes you made, written for a human
reviewer. You group related files into ordered **steps**, each with a short
explanation, so the reviewer reads your change as a narrative instead of an
alphabetical pile of diffs. They open it in the super-review desktop app and
walk the tour step by step, with your commentary above each group of diffs.

## When to run

Run this when you finish a task, or at a meaningful checkpoint. It's safe to run
repeatedly — re-running with the same \`--key\` **updates** the existing session
with your latest changes (and tour) rather than creating a duplicate.

## How: author a tour

1. Make sure your edits are saved (they don't need to be committed) — the diff
   is captured from the current working tree.
2. Pass the tour as inline JSON to \`--tour\`:

\`\`\`bash
super-review session save --key "<your conversation/run id>" --tour '{
  "name": "Short title for the whole change",
  "description": "One or two sentences of overview.",
  "harness": "claude-code",
  "harnessUrl": "<optional resume/permalink to this run>",
  "steps": [
    {
      "title": "Data model",
      "body": "What this group establishes and why. Markdown is supported — **bold**, lists, and \`code\` all render.",
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
\`\`\`

The JSON is passed directly on the command line — wrap it in single quotes so
the shell keeps it as one argument.

### Callouts: point at specific lines

A step's \`callouts\` pin commentary to a **line range** inside one of its files,
rendered as a note right at that spot in the diff — for when "look at lines
42–48" beats describing it in prose. Each callout has:

- \`file\` — one of the step's files.
- \`startLine\`, \`endLine\` — 1-based inclusive range (omit \`endLine\` for one line).
- \`side\` — \`"new"\` (added/current lines, the default) or \`"old"\` (the original).
- \`body\` — Markdown commentary.

Use them for the one or two lines that carry the idea; keep the step \`body\` for
the overview. Don't annotate every line — callouts are for what's easy to miss.

### Writing a good tour

- **Group by idea, not by folder.** Files that change together for one reason
  belong in one step.
- **Order for reading.** Lead with the step that makes the rest make sense
  (often the data model / types); end with tests or cleanup.
- **Explain the why.** The diff already shows *what* changed — the body should
  say *why*, point at the key line, and flag anything non-obvious.
- **List files in reading order** within a step.
- Any changed file you don't place in a step still shows, grouped under
  **"Other changes"** at the end — nothing is hidden, but anything worth the
  reviewer's attention should be in a step.

### Arguments

- \`--key\` — **Always pass the same stable id for the same conversation** (your
  harness's conversation/run id). This is what makes re-runs update the same
  session instead of piling up duplicates.
- \`--tour <json>\` — the tour as inline JSON, passed directly as the argument.
- \`--name\`, \`--description\` — the overview. Required on first save unless the
  tour supplies them. Flags override the tour's values.
- \`--harness\` — one of: \`claude-code\`, \`cursor\`, \`codex\`, \`opencode\`,
  \`copilot\`, \`other\`. Drives the logo on the session card. Use
  \`--harness-label "<name>"\` with \`--harness other\` to label an unlisted tool.
- \`--harness-url\` — Optional. A link back to this run (resume URL or permalink).
- \`--cwd\` — Optional. The repo path; defaults to the current directory.

A quick flat session (no tour) still works: pass \`--name\`/\`--description\`
without \`--tour\`, and every changed file is listed ungrouped.

For a large tour, write the JSON to a temp file and expand it inline with your
shell (e.g. \`--tour "$(cat tour.json)"\`) — the CLI itself only accepts the
JSON, not a path.

## Notes

- The session is a frozen snapshot: it keeps the diff as it was at save time,
  even if the working tree changes afterward. Re-run \`save\` to refresh it.
- If the \`super-review\` command isn't on \`PATH\`, run it with \`npx super-review\` (once
  published), or build the CLI locally with \`pnpm --filter @super-review/cli build\` and invoke
  the bundle directly:
  \`node /path/to/super-review/packages/cli/dist/index.js session save ...\`
- The CLI exits non-zero (with a message) if there are no changes to capture or
  the directory isn't a git repository, and warns if the tour lists a path that
  isn't among the captured changes.
`;
