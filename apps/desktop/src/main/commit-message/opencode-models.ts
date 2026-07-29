import { combineCliOutput } from './cli-error.js';
import { spawnCapture } from './spawn.js';

export interface OpenCodeModelCost {
	input: number;
	output: number;
	cache_read?: number;
	cache_write?: number;
}

export interface OpenCodeModelInfo {
	slug: string;
	cost?: OpenCodeModelCost;
	status?: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._+/-]*$/i;
const FAST_RE = /\b(mini|nano|haiku|flash|lite|small|fast|instant|turbo|micro)\b/i;
const SLOW_RE = /\b(opus|pro|ultra|max|reasoning|thinking|o1|o3|o4|r1)\b/i;

// How many ranked candidates to try before giving up. Providers sometimes list
// models the account cannot actually call (UnknownError / 500).
export const OPENCODE_MODEL_RETRY_LIMIT = 5;

// Parse `opencode models --verbose`: each model is `provider/model` then an
// optional pretty-printed JSON block with cost metadata.
export function parseOpenCodeModelsVerbose(stdout: string): OpenCodeModelInfo[] {
	const lines = stdout.replace(/\r\n/g, '\n').split('\n');
	const models: OpenCodeModelInfo[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]!.trim();
		i += 1;
		if (!line || !SLUG_RE.test(line)) continue;

		const slug = line;
		if (i < lines.length && lines[i]!.trimStart().startsWith('{')) {
			const { json, nextIndex } = readJsonBlock(lines, i);
			i = nextIndex;
			const meta = parseModelMeta(json);
			if (meta?.status === 'deprecated') continue;
			models.push({
				slug,
				cost: meta?.cost,
				status: meta?.status
			});
			continue;
		}

		models.push({ slug });
	}
	return dedupeBySlug(models);
}

export function rankOpenCodeModels(models: OpenCodeModelInfo[]): OpenCodeModelInfo[] {
	return [...models].sort((a, b) => {
		const costDiff = costScore(a.cost) - costScore(b.cost);
		if (costDiff !== 0) return costDiff;
		const speedDiff = speedScore(a.slug) - speedScore(b.slug);
		if (speedDiff !== 0) return speedDiff;
		return a.slug.localeCompare(b.slug);
	});
}

export function selectOpenCodeModelCandidates(
	models: OpenCodeModelInfo[],
	limit = OPENCODE_MODEL_RETRY_LIMIT
): OpenCodeModelInfo[] {
	return rankOpenCodeModels(models).slice(0, Math.max(0, limit));
}

export async function listOpenCodeModels(
	binary: string,
	cwd: string
): Promise<OpenCodeModelInfo[]> {
	// Use the user's real OpenCode config (do not pass OPENCODE_CONFIG) so we
	// see authenticated providers. Fall back to plain `models` if --verbose fails.
	const verbose = await spawnCapture(binary, ['models', '--verbose'], {
		cwd,
		timeoutMs: 30_000
	});
	if (verbose.ok) {
		const parsed = parseOpenCodeModelsVerbose(verbose.stdout);
		if (parsed.length > 0) return parsed;
	}

	const plain = await spawnCapture(binary, ['models'], {
		cwd,
		timeoutMs: 30_000
	});
	if (!plain.ok) {
		const detail = combineCliOutput(plain.stdout, plain.stderr) || plain.error || '';
		throw new Error(detail || 'Failed to list OpenCode models');
	}
	return parseOpenCodeModelsVerbose(plain.stdout);
}

function costScore(cost?: OpenCodeModelCost): number {
	if (!cost) return Number.POSITIVE_INFINITY;
	const input = Number.isFinite(cost.input) ? cost.input : 0;
	const output = Number.isFinite(cost.output) ? cost.output : 0;
	// Prefer free / cheapest on a blended per-1M token score.
	return input + output;
}

function speedScore(slug: string): number {
	// Lower is better. Cheap names win ties; heavy reasoning models lose.
	if (FAST_RE.test(slug)) return -1;
	if (SLOW_RE.test(slug)) return 1;
	return 0;
}

function parseModelMeta(jsonText: string): { cost?: OpenCodeModelCost; status?: string } | null {
	try {
		const parsed = JSON.parse(jsonText) as {
			cost?: {
				input?: unknown;
				output?: unknown;
				cache_read?: unknown;
				cache_write?: unknown;
			};
			status?: unknown;
		};
		const cost =
			parsed.cost && typeof parsed.cost.input === 'number' && typeof parsed.cost.output === 'number'
				? {
						input: parsed.cost.input,
						output: parsed.cost.output,
						...(typeof parsed.cost.cache_read === 'number'
							? { cache_read: parsed.cost.cache_read }
							: {}),
						...(typeof parsed.cost.cache_write === 'number'
							? { cache_write: parsed.cost.cache_write }
							: {})
					}
				: undefined;
		const status = typeof parsed.status === 'string' ? parsed.status : undefined;
		return { cost, status };
	} catch {
		return null;
	}
}

function readJsonBlock(lines: string[], start: number): { json: string; nextIndex: number } {
	const collected: string[] = [];
	let depth = 0;
	let i = start;
	for (; i < lines.length; i++) {
		const line = lines[i]!;
		collected.push(line);
		for (const ch of line) {
			if (ch === '{') depth += 1;
			else if (ch === '}') depth -= 1;
		}
		if (depth <= 0) {
			i += 1;
			break;
		}
	}
	return { json: collected.join('\n'), nextIndex: i };
}

function dedupeBySlug(models: OpenCodeModelInfo[]): OpenCodeModelInfo[] {
	const seen = new Set<string>();
	const out: OpenCodeModelInfo[] = [];
	for (const model of models) {
		if (seen.has(model.slug)) continue;
		seen.add(model.slug);
		out.push(model);
	}
	return out;
}
