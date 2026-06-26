---
name: super-review
description: Make the changes you made in your session easy for a human to review with the Super Review CLI - document them as a guided tour, and read & resolve the reviewer's inline review comments. Use after reaching a checkpoint, or when the reviewer has left comments to address.
metadata:
  version: 1
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

- **Working with review comments.** The reviewer left inline comments on your diff
  and you need to address and resolve them. → Read
  **[review-comments.md](review-comments.md)**.

Both run through the same `super-review` CLI (`npx super-review …`) and share one
`--key`: document the fixes for a batch of comments under a session, then point
each resolved comment back at that session's `--key`.

## How to speak to users

- Avoid using em dashes (`—`) - em dashes often are a sign of poorly written speech and run-on sentences. Avoiding them will make your comments and descriptions far easier to read.
- Use markdown ``syntax to emphasize parts of your descriptions that reference code - reading: "We changed .someFunction" is harder to parse than: "We changed`.someFunction`"
- Avoid overly detailed or technical descriptions when unnecessary - users want to know about architecture they don't necessarily need to know every function name and if they do they can read the code
