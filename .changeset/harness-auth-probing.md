---
'@super-review/core': minor
'@super-review/desktop': minor
'@super-review/ui': minor
'@super-review/storybook': patch
---

Add harness CLI authentication detection and recovery flow.

When a commit message generation or changeset run reaches a harness CLI with no active session, the app now detects this upfront (via auth probes that run the CLI's own status commands) and shows a recovery dialog with the exact login command instead of failing mid-run. Each harness is re-checked when Settings opens (so the user sees live state) and when they dismiss the recovery dialog and come back after signing in. The Agents settings now display each CLI's auth state and signed-in identity.
