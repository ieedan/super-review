---
name: resolve-comments
description: Find and resolve open review comments left on your changes with the super-review CLI - list the unresolved comments on the local branch (or read the inline review comments on the GitHub PR), address each one in code, then reply to and resolve it. Use when a reviewer has left comments to clear, or when asked to resolve, address, or clear review comments.
metadata:
  version: 1
---

Follow and complete the following steps:

- [ ] [#1](#1-find-the-comments)
- [ ] [#2](#2-address-the-comments)
- [ ] [#3](#3-resolve-the-comments)

# 1. Find the comments

Find comments made on the local machine (skip to [#1a](#1a-finding-comments-as-a-cloud-agent) if you are a cloud agent)

```sh
npx super-review comment list --unresolved # finds all local unresolved comments
```

If there are no local comments then run:

```sh
npx super-review comment list --unresolved --pr # finds any review comments on the associated PR for this branch
```

## 1a. Finding comments as a cloud agent

Use the tools available to you to find any UNRESOLVED review comments on the PR associated with the current branch.

# 2. Address the comments

Read and ensure each comment is still valid and not outdated/resolved. Comments that require more information should receive a reply see [#3](#3-resolve-the-comments).

Once you've validated the comments, turn them into a task list. Group related comments together so independent issues can be resolved concurrently.

> [!IMPORTANT]
> A comment points at ONE example of a problem, not the only one. For every comment, treat the underlying issue as a pattern: search ALL changed files for other places the same issue appears and add a task to fix each one. Do NOT stop at the exact line the reviewer pointed to. A reviewer flagging the same bug in three places is a failure of this step. When you add a comment to the task list, write down the pattern you searched for and the files you checked. Any other files turned up by that search belong in the SAME task-list group as the original comment, so the whole pattern is fixed together.

> [!TIP]
> If there are multiple comment groups and you have the ability to you can spin up subagents to resolve multiple comments at the same time each subagent updating the task list.

Once your task list is complete you can move on to #3

# 3. Resolve the comments

Once you're ready you can reply to comments.

If you are working with local comments use the CLI directly (otherwise skip to [3a](#3a-resolving-pr-comments)):

```sh
# reply to a local comment thread - use this whenever the comment needs an
# explanation (a tradeoff, "this doesn't apply because...", asking for more
# info, what you changed and why). `resolve` below has no way to attach a
# note for local comments, so a reply is the only way to leave one.
npx super-review comment reply <id> "<your reply>" --harness <your harness>

# mark a local comment resolved once it's addressed (or once you've replied
# explaining why no change was needed)
npx super-review comment resolve <id> --harness <your harness>
```

> Make sure to pass your harness to the --harness flag the options are (claude-code, cursor, codex, opencode, copilot, other) this will help users understand who acted. Reply before resolving anything that needs explaining - unlike the PR path below, local `resolve` has no `-m`/note option, so a resolve with no prior reply leaves no record of why.

## 3a. Resolving PR comments

You can reply to and resolve PR comments directly with the CLI by adding the `--pr` flag. The `<id>` is the numeric comment id from `comment list --pr`.

```sh
# reply to a PR comment thread
npx super-review comment reply <id> "<your reply>" --pr --harness <your harness>

# resolve a PR comment thread (posts a short note, then marks it resolved)
npx super-review comment resolve <id> --pr --harness <your harness>
```

> Pass `--harness` (claude-code, cursor, codex, opencode, copilot, other) so the note records who acted. The GitHub author of the post is the signed-in user, so the harness and any linked `--session <id>` are added as an attribution footer in the comment body. Add `-m "<note>"` to `resolve` to explain the fix instead of the default "Resolved" note.

If the CLI is not available to you or not authenticated (for example a cloud agent without it installed), use the other tools available to you to resolve and reply instead.

Most of the time resolving a PR comment is enough (obvious bugs, simple changes in behavior, larger refactors where a reply isn't enough) but there are also situations where you should reply (tradeoffs that should be noted, asking for more information).
