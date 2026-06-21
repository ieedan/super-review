---
name: super-review
description: Make the changes you made in your session easy for a human to review with the Super Review CLI - document them as a guided tour, and read & resolve the reviewer's inline review comments. Use after reaching a checkpoint, or when the reviewer has left comments to address.
---

# Super Review

A **session** is a guided **tour** of the changes you made, written for a human
reviewer. They open it in the Super Review desktop app and walk the tour step by
step, with your commentary above each group of diffs. The reviewer can leave
**inline comments** on that diff, which you read and resolve from the CLI.

There are two tasks, each with its own guide — read the one that matches what
you're doing:

- **Documenting your changes as a tour.** After every checkpoint (a feature
  done, a bug fixed, a logical unit of work completed), record a session so the
  reviewer reads your change as a narrative instead of an alphabetical pile of
  diffs. → Read **[document-session.md](document-session.md)**.

- **Resolving review comments.** The reviewer left inline comments on your diff
  and you need to address and resolve them. → Read
  **[resolve-comments.md](resolve-comments.md)**.

Both run through the same `super-review` CLI (`npx super-review …`) and share one
`--key`: document the fixes for a batch of comments under a session, then point
each resolved comment back at that session's `--key`.
