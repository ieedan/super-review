---
'@super-review/desktop': patch
---

Opening a changed file in your editor now jumps to where its diff begins instead of the top of the file. The per-file "Open in editor" button passes the first changed line still present in the file's current state to Cursor, VS Code, Zed, and Xcode (Visual Studio has no line argument, so it opens the file as before).
