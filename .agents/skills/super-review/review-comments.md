# Work with review comments

Reviewers leave **inline comments** on your diff in the Super Review desktop
app, and you read, reply to, and resolve them from the CLI.

> **Only when running on the reviewer's machine.** These comments live locally
> on the reviewer's computer. If you're a **cloud / remote agent** working in a
> fresh checkout (not on the reviewer's machine), there will _never_ be any local
> comments to read — `comment list` returns nothing, so skip this section.

`comment list` shows the comments on the branch you're on - it reads the branch
from git, so you never name it. This finds the comments
waiting on you:

```bash
super-review comment list --unresolved
```

`--json` emits the raw records. The human-readable list groups replies under
their thread root:

```text
<id>  [open]  <path>:L<range>  <first line of the root comment>
  ↳ <reply-id>  <first line of the reply>
```

## Default: fix, document, resolve

For any real code change, address the comment in code, save a session documenting
the fix, then mark the comment resolved and link that session so the reviewer can
jump straight from the comment to your tour:

```bash
super-review comment resolve <id> --harness claude-code --session "<your --key>"
```

- `--harness` - which agent resolved it (drives the logo shown in the app); one
  of `claude-code`, `cursor`, `codex`, `opencode`, `copilot`, `other`.
- `--name <label>` - optional friendlier resolver name, overriding the harness label.
- `--session <id>` - the session `--key` you saved the fix under, so the
  resolution links to your tour. Optional but recommended.
- `super-review comment unresolve <id>` reopens one you resolved by mistake.

## Exception: reply instead of documenting

Only reply as an agent when **both** of these are true:

- The fix is too small to deserve a Super Review session.
- The reviewer needs an explanation that would not be obvious from the diff.

Use a reply for short context like "this was already covered by the existing
guard" or "I renamed the local variable only; behavior is unchanged." Do not use
replies as a substitute for documenting meaningful work. If the fix changes
behavior, touches multiple files, or would benefit from a guided explanation,
save a session and link it from `comment resolve` instead.

```bash
super-review comment reply <id> --harness claude-code "Short explanation for the reviewer."
```

Reply bodies can also come from `--message` or stdin:

```bash
printf '%s\n' "Short explanation for the reviewer." | super-review comment reply <id> --harness claude-code
```

A good loop: `comment list --unresolved` -> fix each comment -> for substantive
fixes, `session save` (see [document-session.md](document-session.md)) and
`comment resolve <id> --session "<key>"`; for tiny fixes that need explanation
only, `comment reply <id> ...` and then resolve the comment without a session if
there is no tour to link.

