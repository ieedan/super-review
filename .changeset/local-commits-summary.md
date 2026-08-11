---
'@super-review/core': minor
'@super-review/desktop': minor
'@super-review/ui': minor
---

feat: summarize the commits waiting to be pushed

The commit box only ever showed the tip commit, so a stack of local work read as
one line and an Undo button. Anything below it meant leaving for the History tab
and opening commits one at a time.

There's now a row under Undo when more than one commit is waiting: "3 more
commits". Hovering it opens a panel with the whole stack, newest first, each
commit showing when it landed, its line counts, and the files it touched. A
commit lists ten files up front and the rest are one click away, so a wide commit
doesn't bury the ones below it. The list scrolls, and commit headers stick as you
go so you always know which commit the files belong to. Click the row to pin the
panel and scroll it from the keyboard; Escape puts it away.

The set is the same one Undo works on: commits on HEAD that aren't on any remote
yet. Push, and the row goes with it.
