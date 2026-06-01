[![npm version](https://flat.badgen.net/npm/v/super-review?color=yellow)](https://npmjs.com/package/super-review)
[![npm downloads](https://flat.badgen.net/npm/dm/super-review?color=yellow)](https://npmjs.com/package/super-review)

# super-review

Document an agent's changes as a guided review session in the [Super Review](https://github.com/ieedan/super-review) desktop app.

## Get Started

```sh
npx super-review session save \
  --key "<conversation id>" \
  --name "What I changed" \
  --description "A sentence or two of overview." \
  --harness claude-code
```

That captures a frozen snapshot of your working-tree changes as a reviewable session. Add a `--tour` to turn it into a walkthrough (see [Authoring a tour](#authoring-a-tour)).

Sessions are written into the repo under `.super-review/sessions/`, so they can be committed and travel with a branch or PR - a reviewer pulls the branch and walks the tour in the desktop app without having authored it.

## How it works

`super-review` is the companion CLI for the Super Review desktop app, meant to be driven by a coding agent (Claude Code, Cursor, Codex, etc.) after it finishes a task. The agent:

1. Makes its edits (they don't need to be committed - the diff is read from the current working tree).
2. Runs `session save` with a `--tour` describing what changed and why.
3. Re-runs the same command with the same `--key` to refresh the session as it iterates.

The result is an isolated, frozen review session: the diff as it was at save time, grouped into explained steps.

## Commands

### `session save`

Capture the working tree's current changes as a reviewable session.

```sh
super-review session save [options]
```

| Option                 | Description                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--key <id>`           | Stable upsert key (your harness conversation/run id). Re-running with the same key **updates** that session.              |
| `--id <id>`            | Target an existing session by its id (alternative to `--key`).                                                            |
| `--name <text>`        | Session name. Required on first save unless a `--tour` supplies it.                                                       |
| `--description <text>` | What you changed. Required on first save unless a `--tour` supplies it.                                                   |
| `--harness <kind>`     | One of `claude-code`, `cursor`, `codex`, `opencode`, `copilot`, `other` (default: `other`). Drives the card logo.         |
| `--harness-label <t>`  | Freeform harness name, used when `--harness other`.                                                                       |
| `--harness-url <url>`  | Deep link back to this run (resume URL or permalink).                                                                     |
| `--tour <json>`        | Inline JSON describing a guided tour (see below). Flags override the document's top-level `name`/`description`/`harness`. |
| `--cwd <path>`         | Repo path (default: current directory).                                                                                   |

### `session clear`

Remove all sessions from the repo (`.super-review/sessions/`) - e.g. before merging a branch.

```sh
super-review session clear [--cwd <path>]
```

## Authoring a tour

A tour groups the change into ordered **steps**, each with a title, a Markdown body, and the files it covers. Pass it as inline JSON to `--tour` - wrap it in single quotes so the shell keeps it as one argument:

```sh
super-review session save --key "<conversation id>" --tour '{
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

- **Top-level `name` / `description` / `harness` / `harnessUrl`** are optional here - flags override them.
- **`steps[].files`** lists the files in reading order. Any changed file you omit still shows, grouped under **"Other changes"** at the end - nothing is hidden.
- **`steps[].callouts`** pin commentary to a line range inside one of the step's files, rendered as a note right at that spot in the diff:
  - `file` - one of the step's files.
  - `startLine`, `endLine` - 1-based inclusive range (omit `endLine` for a single line).
  - `side` - `"new"` (added/current lines, the default) or `"old"` (the original).
  - `body` - Markdown commentary.

## License

[MIT](https://github.com/ieedan/super-review/blob/main/LICENSE)
