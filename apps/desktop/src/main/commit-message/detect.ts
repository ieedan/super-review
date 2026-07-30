import type {
	CommitMessageHarness,
	CommitMessageHarnessInfo,
	CommitMessageHarnessStatus
} from '@super-review/core/types';
import { COMMIT_MESSAGE_HARNESS_PRIORITY, harnessLabel } from '@super-review/core/types';
import { probeHarnessAuth } from './auth-probe.js';
import { which } from './which.js';

// CLI names to probe for each harness. Cursor ships as both `cursor-agent`
// (older/t3code) and `agent` (current docs); either counts as installed.
const HARNESS_BINARIES: Record<CommitMessageHarness, readonly string[]> = {
	// Prefer `agent` (current Cursor CLI); fall back to the older `cursor-agent`.
	cursor: ['agent', 'cursor-agent'],
	'claude-code': ['claude'],
	codex: ['codex'],
	copilot: ['copilot'],
	opencode: ['opencode']
};

export async function resolveHarnessBinary(harness: CommitMessageHarness): Promise<string | null> {
	for (const name of HARNESS_BINARIES[harness]) {
		const bin = await which(name);
		if (bin) return bin;
	}
	return null;
}

const NOT_INSTALLED: CommitMessageHarnessInfo = { installed: false, auth: 'unknown' };

// Which CLIs are installed *and* whether each is signed in. The auth probe runs
// only for installed harnesses, all five in parallel, and is cached in
// auth-probe.ts — so the common case (nothing changed since the last call) costs
// a `which` per harness.
export async function detectCommitMessageHarnesses(): Promise<CommitMessageHarnessStatus> {
	const status = {} as CommitMessageHarnessStatus;
	await Promise.all(
		COMMIT_MESSAGE_HARNESS_PRIORITY.map(async (harness) => {
			const binary = await resolveHarnessBinary(harness);
			if (!binary) {
				status[harness] = NOT_INSTALLED;
				return;
			}
			const probe = await probeHarnessAuth(harness, binary);
			status[harness] = { installed: true, ...probe };
		})
	);
	return status;
}

export function resolvePreferredHarness(
	status: CommitMessageHarnessStatus,
	preferred: CommitMessageHarness | null | undefined
): CommitMessageHarness | null {
	if (preferred && status[preferred]?.installed) return preferred;
	// A signed-in CLI beats a signed-out one when we're falling back — picking
	// the user's behalf should not pick something we already know will fail.
	// `unknown` still counts as usable; only a confirmed 'missing' is skipped.
	for (const harness of COMMIT_MESSAGE_HARNESS_PRIORITY) {
		const info = status[harness];
		if (info?.installed && info.auth !== 'missing') return harness;
	}
	for (const harness of COMMIT_MESSAGE_HARNESS_PRIORITY) {
		if (status[harness]?.installed) return harness;
	}
	return null;
}

// Detect + pick + resolve the binary in one step: what every generation run does
// before it can spawn anything. `ok: false` carries the message to surface and
// the code that decides how the UI recovers.
export type ResolvedHarness =
	| { ok: true; harness: CommitMessageHarness; binary: string }
	| { ok: false; code: 'no-harness'; error: string }
	| { ok: false; code: 'auth'; harness: CommitMessageHarness; error: string };

export async function resolveHarnessForRun(
	preferred: CommitMessageHarness | null | undefined
): Promise<ResolvedHarness> {
	const status = await detectCommitMessageHarnesses();
	const harness = resolvePreferredHarness(status, preferred);
	if (!harness) {
		return {
			ok: false,
			code: 'no-harness',
			error:
				'No supported coding agent CLI found. Install Cursor, Claude Code, Codex, Copilot, or OpenCode and try again.'
		};
	}
	const binary = await resolveHarnessBinary(harness);
	if (!binary) {
		return {
			ok: false,
			code: 'no-harness',
			error: `${harnessLabel(harness)} CLI was detected earlier but is no longer available.`
		};
	}
	// Already known to be signed out: fail now with the fix rather than spending
	// a minute in a spinner to arrive at the same place. Only a confirmed
	// 'missing' stops the run — 'unknown' proceeds and lets the run decide.
	if (status[harness]?.auth === 'missing') {
		return {
			ok: false,
			code: 'auth',
			harness,
			error: explainSignedOut(harness)
		};
	}
	return { ok: true, harness, binary };
}

function explainSignedOut(harness: CommitMessageHarness): string {
	// Deliberately not the raw-CLI-text variant from auth-error.ts: nothing ran,
	// so there is no CLI output to quote.
	return `${harnessLabel(harness)} isn't signed in.`;
}
