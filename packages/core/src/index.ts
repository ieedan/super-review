// Public API of @super-review/core — the pure-node session + git layer shared
// by the super-review CLI (which authors sessions) and the Electron desktop app
// (which reads them). This module is Electron-free; the only OS-trash side of
// `discardChanges` is dependency-injected by the caller.
//
// `types`, `media`, and `hotkeys` are also exposed as dedicated subpath exports
// (`@super-review/core/{types,media,hotkeys}`) so the renderer can import the
// shared types/UI helpers without pulling the node-only git/session modules
// into its browser bundle.
export * from './types.js';
export * from './media.js';
export * from './git-service.js';
export * from './repo-templates.js';
export * from './session-capture.js';
export * from './session-store.js';

// These result types are declared (identically) in both `types.js` — the shared
// IPC/renderer contract — and `git-service.js`, the node implementation that
// returns them. The two `export *` above would make the names ambiguous, so we
// pin them to the `types.js` contract version (an explicit re-export wins over a
// star export). The shapes match, so git-service's return values stay assignable.
export type {
	CloneResult,
	CommitResult,
	CreateBranchResult,
	DeleteBranchResult,
	LastCommit,
	PullPushResult,
	PushStatus
} from './types.js';
