import type { CommitMessageHarness, CommitMessageHarnessStatus } from '@super-review/core/types';
import { COMMIT_MESSAGE_HARNESS_PRIORITY } from '@super-review/core/types';
import { formatClaudeModelLabel } from '@super-review/core/model-label';
import { getCachedCommitMessageModels, setCachedCommitMessageModels } from '../store.js';
import { listOpenCodeModels, rankOpenCodeModels } from './opencode-models.js';
import { detectCommitMessageHarnesses, resolveHarnessBinary } from './detect.js';
import { stripAnsi } from './cli-error.js';
import { spawnCapture } from './spawn.js';
import { createLineReader } from './stream.js';
import { augmentedPath } from './which.js';

export interface CommitMessageModelOption {
	id: string;
	label: string;
}

// The Claude CLI has no `models` command, so the tier aliases *are* the model
// list: `--model haiku|sonnet|opus|fable` always resolves to the newest model in
// that tier. Each one is resolved to a concrete id (see `listClaudeModels`) so
// the picker can show the version; these labels are the unresolved fallback.
const CLAUDE_TIERS = [
	{ alias: 'haiku', label: 'Haiku' },
	{ alias: 'sonnet', label: 'Sonnet' },
	{ alias: 'opus', label: 'Opus' },
	{ alias: 'fable', label: 'Fable' }
] as const;

// Fallback lists when a CLI can't enumerate models.
const CURATED: Record<CommitMessageHarness, CommitMessageModelOption[]> = {
	cursor: [
		{ id: 'composer-2.5-fast', label: 'Composer 2.5 Fast' },
		{ id: 'composer-2.5', label: 'Composer 2.5' },
		{ id: 'composer-2', label: 'Composer 2' },
		{ id: 'auto', label: 'Auto' }
	],
	'claude-code': CLAUDE_TIERS.map((tier) => ({ id: tier.alias, label: tier.label })),
	codex: [
		{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
		{ id: 'gpt-5.3-codex', label: 'Codex 5.3' },
		{ id: 'gpt-5.3-codex-fast', label: 'Codex 5.3 Fast' }
	],
	copilot: [
		{ id: 'claude-haiku-4.5', label: 'Haiku 4.5' },
		{ id: 'gpt-4.1', label: 'GPT-4.1' },
		{ id: 'gpt-5-mini', label: 'GPT-5 mini' }
	],
	opencode: []
};

// How old a cached listing may get before the next read kicks off a background
// refresh. The stale list is still served immediately; only the *next* read sees
// the newer one. Harness model catalogs change on the order of weeks, so this is
// about eventually noticing, not about being current to the minute.
const REVALIDATE_AFTER_MS = 6 * 60 * 60 * 1000;

// Bump whenever the ids or labels a listing produces change, so entries written
// by the previous build are dropped instead of being served until they age out.
// 2: Claude tier aliases resolved to versioned labels ("Haiku" -> "Haiku 4.5").
// 3: stripAnsi widened, so Cursor labels no longer keep a trailing escape.
const MODEL_LIST_VERSION = 3;

// Mirrors the persisted cache so repeat reads don't re-parse the config file.
const cache = new Map<
	CommitMessageHarness,
	{ models: CommitMessageModelOption[]; fetchedAt: number }
>();
const inflight = new Map<CommitMessageHarness, Promise<CommitMessageModelOption[] | null>>();

function readCache(
	harness: CommitMessageHarness
): { models: CommitMessageModelOption[]; fetchedAt: number } | null {
	const hit = cache.get(harness);
	if (hit) return hit;
	const stored = getCachedCommitMessageModels(harness, MODEL_LIST_VERSION);
	if (stored) cache.set(harness, stored);
	return stored;
}

// Probe the CLI and persist the result. Deduped per harness so a warm-up and a
// user-triggered read never spawn the same CLI twice.
function refresh(harness: CommitMessageHarness): Promise<CommitMessageModelOption[] | null> {
	const pending = inflight.get(harness);
	if (pending) return pending;

	const load = (async () => {
		try {
			const listed = await loadModels(harness);
			if (listed && listed.length > 0) {
				const fetchedAt = Date.now();
				cache.set(harness, { models: listed, fetchedAt });
				setCachedCommitMessageModels(harness, listed, fetchedAt, MODEL_LIST_VERSION);
				return listed;
			}
			// The probe failed. Park the curated list in memory (fetchedAt 0, so it
			// always looks stale and every read retries in the background) rather than
			// leaving the cache empty and making the next reader wait on the CLI again.
			const fallback = CURATED[harness];
			if (fallback.length > 0 && !cache.has(harness)) {
				cache.set(harness, { models: fallback, fetchedAt: 0 });
			}
			return listed;
		} finally {
			inflight.delete(harness);
		}
	})();

	inflight.set(harness, load);
	return load;
}

// Never blocks on a CLI probe when anything is cached: the last known list is
// returned right away and a stale one is refreshed in the background. Only a
// harness that has never been listed on this machine can reach the await.
export async function listCommitMessageModels(
	harness: CommitMessageHarness
): Promise<CommitMessageModelOption[]> {
	const hit = readCache(harness);
	if (hit) {
		if (Date.now() - hit.fetchedAt > REVALIDATE_AFTER_MS) void refresh(harness);
		return hit.models;
	}
	return (await refresh(harness)) ?? CURATED[harness];
}

// Fill the cache for every installed harness in the background, so the model
// picker never has to probe a CLI while the user is looking at it. Skips
// harnesses whose cache is still fresh, so it's safe to call on every detect,
// and probes one at a time (only Cursor and OpenCode actually spawn anything).
export async function warmCommitMessageModels(status?: CommitMessageHarnessStatus): Promise<void> {
	const installed = status ?? (await detectCommitMessageHarnesses());
	for (const harness of COMMIT_MESSAGE_HARNESS_PRIORITY) {
		if (!installed[harness]?.installed) continue;
		const hit = readCache(harness);
		if (hit && Date.now() - hit.fetchedAt <= REVALIDATE_AFTER_MS) continue;
		try {
			await refresh(harness);
		} catch {
			// A harness that can't be probed keeps whatever it had cached.
		}
	}
}

// Returns null when a live list couldn't be loaded (caller uses curated fallback
// and must not cache that stub).
async function loadModels(
	harness: CommitMessageHarness
): Promise<CommitMessageModelOption[] | null> {
	// Codex and Copilot can't enumerate models, so their curated lists are the
	// live answer; cache those as-is.
	if (harness === 'codex' || harness === 'copilot') {
		return CURATED[harness];
	}

	const binary = await resolveHarnessBinary(harness);
	if (!binary) return null;

	try {
		if (harness === 'cursor') {
			return await listCursorModels(binary);
		}
		if (harness === 'claude-code') {
			return await listClaudeModels(binary);
		}
		const listed = rankOpenCodeModels(await listOpenCodeModels(binary, process.cwd()));
		return listed.length > 0 ? listed.map((m) => ({ id: m.slug, label: m.slug })) : null;
	} catch {
		return null;
	}
}

export function clearCommitMessageModelCache(): void {
	cache.clear();
	inflight.clear();
}

async function listClaudeModels(binary: string): Promise<CommitMessageModelOption[] | null> {
	const resolved = await Promise.all(
		CLAUDE_TIERS.map((tier) => resolveClaudeTierModel(binary, tier.alias))
	);

	// A tier that didn't resolve still belongs in the list — the alias works
	// either way, it just shows without a version until the next refresh.
	const models = CLAUDE_TIERS.map((tier, i) => {
		const id = resolved[i];
		return { id: tier.alias, label: (id && formatClaudeModelLabel(id)) || tier.label };
	});
	return resolved.some((id) => id !== null) ? models : null;
}

// `claude -p` announces the model it resolved an alias to in a `system`/`init`
// event, emitted before it sends anything to the API. Read that line, then kill
// the process — the prompt is never answered.
async function resolveClaudeTierModel(binary: string, alias: string): Promise<string | null> {
	const controller = new AbortController();
	// Held in an object so TypeScript keeps the type across the stream callback.
	const state: { model: string | null } = { model: null };

	const readLine = createLineReader((line) => {
		if (state.model) return;
		let event: { type?: string; subtype?: string; model?: unknown };
		try {
			event = JSON.parse(line) as typeof event;
		} catch {
			return;
		}
		if (event.type !== 'system' || event.subtype !== 'init') return;
		if (typeof event.model !== 'string' || !event.model) return;
		state.model = event.model;
		controller.abort();
	});

	await spawnCapture(
		binary,
		['-p', '--output-format', 'stream-json', '--verbose', '--model', alias],
		{
			cwd: process.cwd(),
			// Never read: the run is killed at the init event.
			stdin: '.',
			timeoutMs: 20_000,
			signal: controller.signal,
			env: { PATH: augmentedPath() },
			onStdoutChunk: readLine
		}
	);

	return state.model;
}

async function listCursorModels(binary: string): Promise<CommitMessageModelOption[] | null> {
	const result = await spawnCapture(binary, ['models'], {
		cwd: process.cwd(),
		timeoutMs: 30_000,
		env: {
			PATH: augmentedPath()
		}
	});

	const raw = stripAnsi(`${result.stdout}\n${result.stderr}`);
	const models = parseCursorModelsOutput(raw);
	return models.length > 0 ? models : null;
}

export function parseCursorModelsOutput(raw: string): CommitMessageModelOption[] {
	const models: CommitMessageModelOption[] = [];
	const seen = new Set<string>();
	for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || /^available models$/i.test(trimmed)) continue;
		if (/^tip:/i.test(trimmed)) continue;
		// `id - Label` or `id - Label  (current, default)`
		const match = /^([a-z0-9][a-z0-9._+/-]*)\s+-\s+(.+)$/i.exec(trimmed);
		if (!match) continue;
		const id = match[1]!;
		if (seen.has(id)) continue;
		seen.add(id);
		const label = match[2]!.replace(/\s+\(.*\)\s*$/, '').trim();
		if (!label) continue;
		models.push({ id, label });
	}
	return models;
}
