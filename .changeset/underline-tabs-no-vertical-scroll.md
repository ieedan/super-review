---
'@super-review/desktop': patch
---

fix: the branch picker's tabs no longer scroll vertically when pressing the up or down arrow keys

The tab list's active underline poked 1px past its padding box, and because the list is `overflow-x-auto` the browser made it vertically scrollable too. The bottom rule is now an inset shadow and the underline sits inside the box, so there is nothing to scroll.
