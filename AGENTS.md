# AGENTS.md

## Document your work after every checkpoint

After every checkpoint you reach in a coding task (a feature done, a bug fixed,
a logical unit of work completed), create a super-review session locally so a
human can review your changes as a guided tour.

Run (use the same `--key` for the whole conversation so re-runs update the same
session instead of creating duplicates):

```bash
pnpx super-review session save --key "<your conversation/run id>" --tour '<tour json>'
```

For the tour JSON shape, callouts, and all flags, see
[.agents/skills/document-session/SKILL.md](.agents/skills/document-session/SKILL.md).
