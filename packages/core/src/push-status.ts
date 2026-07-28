import type { PushStatus } from './types.js';

// Shared answers to "is there anything for the push flow to do?", used by the
// header buttons, the native Repository > Push menu item (and its ⌘P
// accelerator), and the store action itself so all three agree.

// True when pushing would actually send something: either the branch has no
// upstream yet (first push publishes it) or it has commits the remote lacks.
// A branch that is only behind has nothing to push, so this is false for it.
export function hasCommitsToPush(status: PushStatus | null | undefined): boolean {
	if (!status || !status.hasRemote) return false;
	if (!status.hasUpstream) return true;
	return status.ahead > 0;
}

// True when the push flow (fetch, pull if behind, then push) has any work to
// do. Wider than `hasCommitsToPush` because the same flow doubles as the sync
// action for a branch that is only behind.
export function canSync(status: PushStatus | null | undefined): boolean {
	if (!status || !status.hasRemote) return false;
	if (!status.hasUpstream) return true;
	return status.ahead > 0 || status.behind > 0;
}
