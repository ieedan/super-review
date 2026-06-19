---
'@super-review/desktop': patch
---

fix: render an empty diff for files with no content (e.g. a newly added empty file) instead of surfacing Pierre's "identical sides" parse error. The bogus error previously lingered and prevented the diff from rendering once the file gained content.
