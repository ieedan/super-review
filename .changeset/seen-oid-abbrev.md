---
'@super-review/core': patch
'@super-review/ui': patch
---

fix: stop losing "seen" marks after a new commit. The seen signature stored git's abbreviated blob OID, and git grows that abbreviation as the repo gains objects, so the same unchanged file looked "changed" on the next refresh and its mark was cleared. Diffs now record full blob OIDs, and the change detector tolerates abbreviation-length drift so existing marks survive the upgrade.
