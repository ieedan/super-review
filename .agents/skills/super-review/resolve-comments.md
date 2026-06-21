# Respond to review comments

Reviewers leave **inline comments** on your diff in the Super Review desktop
app, and you read and resolve them from the CLI.

> **Only when running on the reviewer's machine.** These comments live locally
> on the reviewer's computer. If you're a **cloud / remote agent** working in a
> fresh checkout (not on the reviewer's machine), there will _never_ be any local
> comments to read — `comment list` returns nothing, so skip this section.

`comment list` shows the comments on the branch you're on — it reads the branch
from git, so you never name it (you're only ever on one). This finds the comments
waiting on you:

```bash
super-review comment list --unresolved
```

`--json` emits the raw records. Each human-readable line is
`<id>  [open]  <path>:L<range>  <first line of the comment>`.

Address each comment in code, then mark it resolved - and link the session that
documents the fix so the reviewer can jump straight from the comment to your
tour:

```bash
super-review comment resolve <id> --harness claude-code --session "<your --key>"
```

- `--harness` - which agent resolved it (drives the logo shown in the app); one
  of `claude-code`, `cursor`, `codex`, `opencode`, `copilot`, `other`.
- `--name <label>` - optional friendlier resolver name, overriding the harness label.
- `--session <id>` - the session `--key` you saved the fix under, so the
  resolution links to your tour. Optional but recommended.
- `super-review comment unresolve <id>` reopens one you resolved by mistake.

A good loop: `comment list --unresolved` -> fix each comment -> `session save`
to document the fixes under one `--key` (see
[document-session.md](document-session.md)) -> `comment resolve <id> --session
"<key>"` for every comment you addressed.
