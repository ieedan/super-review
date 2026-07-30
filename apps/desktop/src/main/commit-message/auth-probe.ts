// Asking each harness CLI whether it is signed in, before we ask it to work.
//
// Detection used to stop at "is the binary on PATH", so a signed-out CLI looked
// identical to a working one right up until a generation failed minutes later.
// Each probe below runs that CLI's own cheapest "am I signed in" path.
//
// Every probe is free: none of them reaches a model, so none costs tokens.
// Claude Code is the interesting one — it has no status subcommand, but the
// stream-json control protocol answers an `initialize` request with the account
// record before any inference happens, so we send exactly that one request and
// kill the process (~700ms).
//
// The bias throughout is toward 'unknown' over 'missing': claiming a working
// CLI is signed out would send the user chasing a login they don't need, so
// anything we can't read confidently stays unknown and the run proceeds.

import type { CommitMessageHarness, HarnessAuthState } from '@super-review/core/types';
import { stripAnsi } from '@super-review/core/harness-auth';
import { spawnCapture } from './spawn.js';

export interface HarnessAuthProbe {
	auth: HarnessAuthState;
	account?: string;
	plan?: string;
}

const UNKNOWN: HarnessAuthProbe = { auth: 'unknown' };

// Long enough for a cold CLI start on a slow disk, short enough that opening
// Agents settings never feels hung. Probes run in parallel across harnesses.
const PROBE_TIMEOUT_MS = 10_000;

// Auth changes out of band (the user signs in via a terminal we don't own), so
// this can't be cached for the session — but detection is called on every
// settings open and every generation, and re-running five CLIs each time is
// pure latency. A short TTL keeps the common case instant while still noticing
// a fresh login within a minute. `clearHarnessAuthCache` covers the impatient
// case (an explicit refresh from the UI).
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
	at: number;
	probe: HarnessAuthProbe;
}
const cache = new Map<string, CacheEntry>();

export function clearHarnessAuthCache(): void {
	cache.clear();
}

export async function probeHarnessAuth(
	harness: CommitMessageHarness,
	binary: string
): Promise<HarnessAuthProbe> {
	const key = `${harness}:${binary}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.probe;

	let probe: HarnessAuthProbe;
	try {
		probe = await runProbe(harness, binary);
	} catch {
		// A probe that throws tells us nothing about the user's session.
		probe = UNKNOWN;
	}
	cache.set(key, { at: Date.now(), probe });
	return probe;
}

function runProbe(harness: CommitMessageHarness, binary: string): Promise<HarnessAuthProbe> {
	switch (harness) {
		case 'claude-code':
			return probeClaude(binary);
		case 'cursor':
			return probeCursor(binary);
		case 'codex':
			return probeCodex(binary);
		case 'opencode':
			return probeOpenCode(binary);
		case 'copilot':
			// The Copilot CLI signs in through an interactive `/login` inside its
			// TUI and ships no non-interactive status command, so there is nothing
			// to ask. Its runtime errors still classify as auth failures.
			return Promise.resolve(UNKNOWN);
	}
}

// ─── Claude Code ──────────────────────────────────────────────────────────

interface ClaudeAccount {
	tokenSource?: string;
	apiProvider?: string;
	email?: string;
	subscriptionType?: string;
}

async function probeClaude(binary: string): Promise<HarnessAuthProbe> {
	const request =
		JSON.stringify({
			type: 'control_request',
			request_id: 'super-review-auth-probe',
			request: { subtype: 'initialize' }
		}) + '\n';

	let account: ClaudeAccount | null = null;
	let done = false;
	let kill: (() => void) | null = null;
	let buffer = '';

	const onChunk = (chunk: string) => {
		if (done) return;
		buffer += chunk;
		let index: number;
		while ((index = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, index);
			buffer = buffer.slice(index + 1);
			if (!line.trim()) continue;
			let event: Record<string, unknown>;
			try {
				event = JSON.parse(line) as Record<string, unknown>;
			} catch {
				continue;
			}
			if (event.type !== 'control_response') continue;
			const response = (event.response as { response?: { account?: ClaudeAccount } } | undefined)
				?.response;
			account = response?.account ?? {};
			done = true;
			// We have what we came for; the CLI would otherwise sit waiting for a
			// prompt on stdin until the timeout.
			kill?.();
			return;
		}
	};

	await spawnCapture(
		binary,
		['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'],
		{
			cwd: process.cwd(),
			stdin: request,
			timeoutMs: PROBE_TIMEOUT_MS,
			onStdoutChunk: onChunk,
			onSpawn: (child) => {
				kill = () => {
					try {
						child.kill('SIGKILL');
					} catch {
						// already gone
					}
				};
			}
		}
	);

	if (!account) return UNKNOWN;
	const { tokenSource, apiProvider, email, subscriptionType } = account as ClaudeAccount;
	if (!tokenSource) return UNKNOWN;
	// Bedrock/Vertex users authenticate with cloud credentials the CLI doesn't
	// own, and report no token source of their own. Not a signed-out account.
	if (tokenSource === 'none' && apiProvider && apiProvider !== 'firstParty') return UNKNOWN;
	if (tokenSource === 'none') return { auth: 'missing' };
	return {
		auth: 'ok',
		...(email ? { account: email } : {}),
		...(subscriptionType ? { plan: subscriptionType } : {})
	};
}

// ─── Cursor ───────────────────────────────────────────────────────────────

async function probeCursor(binary: string): Promise<HarnessAuthProbe> {
	const result = await spawnCapture(binary, ['status', '--format', 'json'], {
		cwd: process.cwd(),
		timeoutMs: PROBE_TIMEOUT_MS
	});
	if (result.timedOut) return UNKNOWN;
	const parsed = parseJsonObject(result.stdout);
	if (!parsed) return UNKNOWN;
	const authenticated =
		typeof parsed.isAuthenticated === 'boolean'
			? parsed.isAuthenticated
			: parsed.status === 'authenticated'
				? true
				: parsed.status === 'unauthenticated'
					? false
					: undefined;
	if (authenticated === undefined) return UNKNOWN;
	if (!authenticated) return { auth: 'missing' };
	const email = (parsed.userInfo as { email?: unknown } | undefined)?.email;
	return { auth: 'ok', ...(typeof email === 'string' && email ? { account: email } : {}) };
}

// ─── Codex ────────────────────────────────────────────────────────────────

async function probeCodex(binary: string): Promise<HarnessAuthProbe> {
	const result = await spawnCapture(binary, ['login', 'status'], {
		cwd: process.cwd(),
		timeoutMs: PROBE_TIMEOUT_MS
	});
	if (result.timedOut) return UNKNOWN;
	const text = stripAnsi(`${result.stdout}\n${result.stderr}`);
	if (/\bnot logged ?in\b/i.test(text)) return { auth: 'missing' };
	const loggedIn = text.match(/logged in(?: using ([^\n.]+))?/i);
	if (!loggedIn) return UNKNOWN;
	// The CLI reports the method ("using ChatGPT", "using an API key") rather
	// than an identity, which is still the useful thing to show.
	const method = loggedIn[1]?.trim();
	return { auth: 'ok', ...(method ? { plan: method } : {}) };
}

// ─── OpenCode ─────────────────────────────────────────────────────────────

async function probeOpenCode(binary: string): Promise<HarnessAuthProbe> {
	const result = await spawnCapture(binary, ['auth', 'list'], {
		cwd: process.cwd(),
		timeoutMs: PROBE_TIMEOUT_MS
	});
	if (result.timedOut) return UNKNOWN;
	const text = stripAnsi(`${result.stdout}\n${result.stderr}`);
	// OpenCode has no single account — it lists per-provider credentials and
	// closes with a count. No credentials means nothing can serve a model.
	const count = text.match(/(\d+)\s+credentials?\b/i);
	if (!count) return UNKNOWN;
	const parsedCount = Number(count[1]);
	if (!Number.isFinite(parsedCount)) return UNKNOWN;
	if (parsedCount === 0) return { auth: 'missing' };
	return { auth: 'ok', plan: `${parsedCount} provider${parsedCount === 1 ? '' : 's'}` };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function parseJsonObject(raw: string): Record<string, unknown> | null {
	const text = stripAnsi(raw);
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start < 0 || end <= start) return null;
	try {
		const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
