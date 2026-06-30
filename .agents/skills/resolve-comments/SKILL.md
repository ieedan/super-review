---
name: resolve-comments
description: Find and resolve open review comments left on your changes with the super-review CLI - list the unresolved comments on the local branch (or read the inline review comments on the GitHub PR), address each one in code, then reply to and resolve it. Use when a reviewer has left comments to clear, or when asked to resolve, address, or clear review comments.
metadata:
  version: 1
---

# Resolve review comments

Reviewers leave **inline comments** on your diff in the Super Review desktop app.
This skill is the loop for clearing them: list what is open, fix each one in code,
then reply to and resolve it from the `super-review` CLI. Comments live in two
places and the CLI reaches each differently:

- **Local branch comments** - written by the reviewer's desktop app into a
  per-machine SQLite database (`~/.super-review/comments.db`). `comment list`,
  `reply`, `resolve`, and `unresolve` all act on these. They are scoped to the
  branch you are on, read from git, so you never name the branch.
- **GitHub PR comments** - inline review comments on the pull request.
  `comment list --pr` reads these over the GitHub API. This is **list-only**:
  there is no CLI command to resolve a PR review thread (see Gotchas).

All commands run through `npx super-review` (published CLI, currently `0.0.6`).
Paths below are relative to the repo root.

## Run the workflow (agent path)

`comment list --unresolved` is how you find the work. It reads the branch from
git, so you do not pass a branch name:

```bash
npx super-review comment list --unresolved
```

The human-readable list groups replies under their thread root:

```text
<id>  [open]  <path>:L<range>  <first line of the root comment>
  ↳ <reply-id>  <first line of the reply>
```

Add `--json` for the raw records (every field, including `inReplyTo` and
resolution state). For each open comment: **fix it in code**, then resolve it.
`--harness` sets which agent's logo shows in the app; it is one of
`claude-code`, `cursor`, `codex`, `opencode`, `copilot`, `other`:

```bash
npx super-review comment resolve <id> --harness claude-code
```

Link the session that documents your fix so the reviewer can jump from the
comment to your tour (the `--key` you saved the session under; the CLI validates
it exists):

```bash
npx super-review comment resolve <id> --harness claude-code --session "<your-session-key>"
```

Reply when the reviewer needs a short explanation the diff does not make obvious
(`--message` or stdin also work for the body):

```bash
npx super-review comment reply <id> --harness claude-code "Restored the + operator."
```

`comment unresolve <id>` reopens one you resolved by mistake. `--name <label>`
overrides the harness label on a reply or resolve.

### Reading PR comments instead

When you are a remote/cloud agent in a fresh checkout, there are **no** local
comments (the database lives on the reviewer's machine), so `comment list`
returns nothing. Read the PR's inline review comments instead. With no number it
detects the open PR for the current branch; pass a number to pin one:

```bash
npx super-review comment list --pr
npx super-review comment list --pr 42
```

This needs a GitHub token: the Super Review app's sign-in, or `GH_TOKEN` /
`GITHUB_TOKEN`. Output is tagged `[review]` with the author. To _resolve_ a PR
thread, address it in code and resolve the thread on GitHub (reply + resolve via
the GitHub API/MCP); the CLI does not do this.

## Gotchas

- **PR resolve is not a CLI op.** `comment resolve` only marks _local_ comments.
  GitHub review threads have no "resolved" state in the REST API the CLI uses
  (it is a GraphQL concept), so PR threads listed by `--pr` are tagged `[review]`,
  not open/resolved, and you resolve them on GitHub, not here.
- **No local comments on a fresh checkout.** Local comments are per-machine. A
  cloud/remote agent finds none with `comment list`; use `--pr` instead. This is
  expected, not an error.
- **`--pr` needs a real github.com origin.** It parses owner/repo from the
  `origin` remote. In this container, git rewrites github remotes to a local
  proxy URL, so `--pr` fails with `couldn't determine the GitHub owner/repo from
the 'origin' remote`. On a normal machine with a `github.com` origin it works.
- **Resolution is thread-level.** `--unresolved` drops a whole thread once its
  root is resolved; replies never carry their own resolved state.
- **No CLI creates comments.** Only the desktop app writes them. To try the loop
  without a real reviewer, seed `~/.super-review/comments.db` directly (see
  "Dry-running without real comments").

## Troubleshooting

- `error: no session with id "<key>" in this repo` - the `--session` key you
  passed to `resolve` does not match a saved session. Save the session first, or
  drop `--session`.
- `error: no comment with id "<id>" in this repo` - wrong id. Re-run
  `comment list` (ids change nothing, but a resolved/renamed thread may have
  moved) and copy the id from the current output.
- `error: empty reply: ...` - `reply` got no body. Pass it as the argument,
  `--message`, or on stdin.
- `no GitHub token available` on `--pr` - sign in with the Super Review app or
  export `GH_TOKEN` / `GITHUB_TOKEN`.
