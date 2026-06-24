---
'@super-review/desktop': patch
---

Error notifications now stack instead of overwriting each other, so a new error never silently replaces one you haven't read yet — each toast can be dismissed on its own. Every error toast also gains a one-click "Report" button that opens the feedback dialog prefilled as a bug report, including the action that was running and where you were in the app, so reports carry useful detail for debugging.
