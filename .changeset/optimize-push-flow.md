---
'@super-review/core': patch
'@super-review/ui': patch
---

feat(push): optimize push workflow by trying direct push before fetch

Adds non-fast-forward detection to skip unnecessary fetch when remote hasn't moved. Push now attempts a direct push if the branch isn't known to be behind, and only falls back to fetch+pull+push on non-fast-forward rejection. This reduces network round trips and improves perceived responsiveness. Also makes PR refresh non-blocking since it's not required for push completion.
