# AGENTS.md

## Document your work after every checkpoint

After every checkpoint you reach in a coding task (a feature done, a bug fixed,
a logical unit of work completed), create a super-review **slice** locally so a
human can review your changes as a guided tour. A slice stores no code — only
where to look (paths + line callouts) and what to say — so it always renders the
live diff of your branch's changes (committed and uncommitted).

Run (use the same `--key` for the whole conversation so re-runs update the same
slice instead of creating duplicates):

```bash
super-review slice save --key "<your conversation/run id>" --tour '<tour json>'
```

For the tour JSON shape, callouts, and all flags, see
[.agents/skills/document-session/SKILL.md](.agents/skills/document-session/SKILL.md).
(`super-review session save` still works as a deprecated alias for one release.)
