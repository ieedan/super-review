import path from 'node:path';
import {
	getCurrentBranch,
	harnessLabel,
	type HarnessKind,
	type TaskActor
} from '@super-review/core';
import { fail, repoRoot } from '../../util';

export const HARNESSES: HarnessKind[] = [
	'claude-code',
	'cursor',
	'codex',
	'opencode',
	'copilot',
	'other'
];

// Flags shared by every task command: where the repo is and (optionally) which
// branch's list to operate on.
export interface TaskCommonOptions {
	cwd?: string;
	branch?: string;
}

// The identity flags shared by the mutating commands (add / done / undone).
export interface ActorOptions {
	harness?: string;
	name?: string;
}

// Validate --harness and return the typed value (or undefined).
export function parseHarness(harness: string | undefined): HarnessKind | undefined {
	if (harness && !HARNESSES.includes(harness as HarnessKind)) {
		fail(`invalid --harness "${harness}". Expected one of: ${HARNESSES.join(', ')}`);
	}
	return harness as HarnessKind | undefined;
}

// CLI task actions are agent-authored; identify via --harness (its logo shows in
// the app) with an optional friendlier --name, mirroring `comment reply`.
export function buildActor(opts: ActorOptions): TaskActor {
	const harness = parseHarness(opts.harness);
	return {
		kind: 'agent',
		name: opts.name?.trim() || (harness ? harnessLabel(harness) : 'Agent'),
		...(harness ? { harness } : {})
	};
}

// Resolve the repo root and the branch whose task list we operate on. Tasks are
// per-branch, so a detached HEAD (no current branch) is an error unless --branch
// names one explicitly.
export async function resolveTarget(
	opts: TaskCommonOptions
): Promise<{ root: string; branch: string }> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);
	// simple-git reports a detached HEAD as the literal "HEAD" rather than null, and
	// "HEAD" is never a valid branch name — treat either as "no branch".
	const current = await getCurrentBranch(root);
	const branch = opts.branch?.trim() || (current && current !== 'HEAD' ? current : null);
	if (!branch) fail('not on a branch (detached HEAD); pass --branch <name> to pick a task list.');
	return { root, branch };
}
