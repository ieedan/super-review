---
"@super-review/desktop": patch
---

Separate the header button loading states so only one spinner shows at a time.

The Refresh, Update branch, and Create PR/Push buttons all read the shared push state, distinguished only by the coarse `intent` field. Any pull-shaped operation (pull, update-from-default, upstream sync) lit up multiple buttons at once, the Create PR/Push button spun for any in-progress operation even though opening the create-PR page does no push work, and every operation's trailing file/branch refresh spun the Refresh icon on top of the owning button. A precise `op` discriminator now attributes each spinner to exactly one button, so the header never shows two spinners for a single operation.
