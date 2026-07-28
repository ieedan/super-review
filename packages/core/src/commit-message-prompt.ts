// Default instructions for AI commit-message generation (no branch/files/patch).
// Editable in the generate popover and persisted in prefs; the main process
// always appends the current change context after this base.
export const DEFAULT_COMMIT_MESSAGE_BASE_PROMPT = `Write a *concise* conventional commit message for this set of changes.
If there are multiple changes, list them as bullets in the body of the commit message and do your best to either:
1. summarize the changes into a single sentence for a commit title
2. if all the changes relate to one feature use that feature as the headline`;
