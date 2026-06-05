import { randomUUID } from 'node:crypto';
import { simpleGit } from 'simple-git';
import { makeAnchor, type Anchor } from './anchor.js';
import {
	detectDefaultBranch,
	getCurrentBranch,
	getDiff,
	listChangedFiles,
	repoIdFromPath
} from './git-service.js';
import type { DiffContext, HarnessKind, Slice, SliceCallout, SliceStep } from './types.js';

// A line-range callout as authored by the caller, before validation/anchoring.
export interface SliceCalloutInput {
	file: string;
	startLine: number;
	endLine?: number;
	// Which side the line numbers refer to: "new" = additions, "old" = deletions.
	// Mapped to the Anchor's LEFT/RIGHT on capture.
	side?: 'new' | 'old';
	body: string;
}

// A tour step as authored by the caller (CLI), before validation. `files` are
// repo-relative paths that should be among the slice's files.
export interface SliceStepInput {
	title: string;
	body?: string;
	files: string[];
	callouts?: SliceCalloutInput[];
}

// Metadata supplied by the caller when saving a slice. Everything but the diff —
// the diff is never stored; only the file scope, narrative, and (auto-computed)
// anchors are persisted. The diff is recomputed live on every render.
export interface SliceMeta {
	key?: string;
	title?: string;
	description?: string;
	author?: { kind: 'agent' | 'human'; name: string; harness?: HarnessKind };
	// The guided tour. When omitted on an update, the existing slice's steps are
	// carried over (and re-validated/re-anchored against the fresh diff).
	steps?: SliceStepInput[];
	// The branch this slice documents. Defaults to the current branch.
	branch?: string;
}

// Build the union DiffContext a slice renders over: everything the branch changes
// against its fork point (committed + uncommitted). The base is the repo's
// detected default branch; when none can be detected the union degrades to the
// working tree (see resolveUnionOldRef).
async function unionContextFor(repoPath: string): Promise<DiffContext> {
	const git = simpleGit(repoPath);
	const base = (await detectDefaultBranch(git).catch(() => undefined)) ?? 'HEAD';
	return { kind: 'union', base, head: 'HEAD' };
}

// Capture (or update) a content-free slice. `files` is the slice's scope: the
// explicit list when given, else every file the live union diff reports as
// changed. Tour steps are validated against that scope; each callout is anchored
// (fingerprinted) against the live side contents so it follows drift on later
// renders. No diff content is ever stored.
export async function captureSlice(
	repoPath: string,
	meta: SliceMeta,
	existing?: Slice | null,
	files?: string[]
): Promise<Slice> {
	const repo = repoIdFromPath(repoPath);
	const branch =
		meta.branch ??
		existing?.branch ??
		(await getCurrentBranch(repoPath).catch(() => null)) ??
		undefined;

	const ctx = await unionContextFor(repoPath);
	const changed = await listChangedFiles(repoPath, ctx);
	const changedPaths = new Set(changed.map((f) => f.path));

	// Resolve the slice's file scope: an explicit list (intersected with what the
	// diff actually shows, so we never reference a phantom file), else everything
	// the union diff changed.
	const scope = files
		? files.filter((p) => changedPaths.has(p))
		: changed.map((f) => f.path);
	const scopeSet = new Set(scope);

	// Fetch each scoped file's live diff once, so callout anchoring and the
	// additions/deletions card hints share a single read per file.
	const diffs = new Map<string, Awaited<ReturnType<typeof getDiff>>>();
	let additions = 0;
	let deletions = 0;
	for (const p of scope) {
		const diff = await getDiff(repoPath, p, ctx);
		diffs.set(p, diff);
		additions += diff.file.additions;
		deletions += diff.file.deletions;
	}

	// Authored steps, else carry the existing slice's tour over (re-anchored
	// below against the fresh diff).
	const stepInput: SliceStepInput[] =
		meta.steps ??
		existing?.steps?.map((s) => ({
			title: s.title,
			body: s.body,
			files: s.paths,
			callouts: s.callouts?.map((c) => ({
				file: c.anchor.file,
				startLine: c.anchor.startLine,
				endLine: c.anchor.endLine,
				side: c.anchor.side === 'LEFT' ? ('old' as const) : ('new' as const),
				body: c.body
			}))
		})) ??
		[];

	const steps = buildSteps(stepInput, scopeSet, diffs);

	const now = Date.now();
	return {
		id: existing?.id ?? randomUUID(),
		repo,
		branch,
		key: meta.key ?? existing?.key,
		author: meta.author ??
			existing?.author ?? { kind: 'agent', name: 'unknown', harness: 'other' },
		title: meta.title ?? existing?.title ?? 'Untitled slice',
		description: meta.description ?? existing?.description ?? '',
		files: scope,
		steps,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		additions,
		deletions
	};
}

// Validate authored steps against the slice's scope and anchor their callouts.
// Steps whose every path falls outside the scope are dropped. Each callout is
// fingerprinted against the live side contents; one that can't be anchored
// (out-of-range range) keeps its range as a hint with an empty fingerprint, so
// it surfaces as "outdated" rather than vanishing.
function buildSteps(
	input: SliceStepInput[],
	scope: Set<string>,
	diffs: Map<string, { oldContents: string; newContents: string }>
): SliceStep[] {
	const steps: SliceStep[] = [];
	for (const raw of input) {
		const paths = raw.files.filter((p) => scope.has(p));
		if (paths.length === 0) continue;
		const stepId = `step-${steps.length + 1}`;
		const stepPaths = new Set(paths);
		const callouts: SliceCallout[] = [];
		for (const c of raw.callouts ?? []) {
			if (!stepPaths.has(c.file)) continue;
			const start = Math.max(1, Math.floor(c.startLine));
			const end = Math.max(start, Math.floor(c.endLine ?? c.startLine));
			if (!Number.isFinite(start)) continue;
			const side: Anchor['side'] = c.side === 'old' ? 'LEFT' : 'RIGHT';
			const diff = diffs.get(c.file);
			const sideContents =
				side === 'LEFT' ? (diff?.oldContents ?? '') : (diff?.newContents ?? '');
			const anchor =
				makeAnchor(c.file, side, start, end, sideContents) ??
				({ file: c.file, side, startLine: start, endLine: end, fingerprint: '' } as Anchor);
			callouts.push({
				id: `${stepId}-c${callouts.length + 1}`,
				anchor,
				body: c.body ?? ''
			});
		}
		steps.push({
			id: stepId,
			title: raw.title,
			body: raw.body ?? '',
			paths,
			callouts
		});
	}
	return steps;
}
