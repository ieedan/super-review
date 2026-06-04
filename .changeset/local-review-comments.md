---
'@super-review/desktop': patch
'@super-review/core': patch
'super-review': patch
---

feat: add local review comments — per-line notes stored under `.super-review/comments` that travel with a branch like sessions. Author and resolve them in a new right-hand Comments sidebar (and inline in the diff), copy them as agent-ready prompts, and let agents read (`super-review comment list`) and resolve (`super-review comment resolve`) them, optionally linking the session that addressed the feedback.
