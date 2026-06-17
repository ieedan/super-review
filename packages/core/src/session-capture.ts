import { randomUUID } from 'node:crypto';
import { simpleGit } from 'simple-git';
import { getCurrentBranch, getDiff, listChangedFiles, repoIdFromPath } from './git-service.js';
import type { DiffContext, Session, SessionCallout, SessionFile, SessionStep } from './types.js';

// A line-range callout as authored by the caller, before validation.
export interface TourCalloutInput {
	file: string;
	startLine: number;
	endLine?: number;
	side?: 'new' | 'old';
	body: string;
}

// A tour step as authored by the caller (CLI), before validation. `files` are
// repo-relative paths that should match the captured working-tree changes.
export interface TourStepInput {
	title: string;
	body?: string;
	files: string[];
	callouts?: TourCalloutInput[];
}

// Metadata supplied by the caller (CLI) when saving a session. Everything but
// the diff itself — the diff is re-captured fresh on every save, from the
// working tree by default or from a base...head branch diff when the caller
// passes a branch DiffContext (so changes can be documented after committing).
export interface SessionMeta {
	key?: string;
	name?: string;
	description?: string;
	harness?: Session['harness'];
	harnessLabel?: string;
	harnessUrl?: string;
	// The guided tour. When omitted on an update, the existing session's steps
	// are carried over (and re-validated against the fresh file set).
	steps?: TourStepInput[];
}

// Build validated tour steps from authored input: keep only paths that match a
// captured file, preserve authoring order, and assign stable ids. Steps left
// with no surviving paths (their files vanished from the working tree) are
// dropped so the tour never points at a file that isn't in the snapshot.
function buildSteps(input: TourStepInput[], knownPaths: Set<string>): SessionStep[] {
	const steps: SessionStep[] = [];
	for (const raw of input) {
		const paths = raw.files.filter((p) => knownPaths.has(p));
		if (paths.length === 0) continue;
		const stepId = `step-${steps.length + 1}`;
		// Keep only callouts whose file is part of this step and whose range is
		// sane; normalize the side and order the bounds.
		const stepPaths = new Set(paths);
		const callouts: SessionCallout[] = [];
		for (const c of raw.callouts ?? []) {
			if (!stepPaths.has(c.file)) continue;
			const start = Math.max(1, Math.floor(c.startLine));
			const end = Math.max(start, Math.floor(c.endLine ?? c.startLine));
			if (!Number.isFinite(start)) continue;
			callouts.push({
				id: `${stepId}-c${callouts.length + 1}`,
				file: c.file,
				startLine: start,
				endLine: end,
				side: c.side === 'old' ? 'old' : 'new',
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

// Capture a frozen snapshot of the repo's changes into a Session. `ctx` selects
// what's captured: the live working tree (default) or a base...head branch diff,
// which lets a change be documented after it's been committed. When the metadata
// (or carried-over existing session) supplies a tour, the capture is scoped to
// just the files that tour references, so the session shows only the changes the
// agent documented rather than every edit in the working tree. When `existing`
// is supplied this is an update: its id/createdAt (and any metadata the caller
// didn't override) are preserved, but the file diffs are re-captured fresh so
// the session reflects the latest changes.
export async function captureSession(
	repoPath: string,
	meta: SessionMeta,
	existing?: Session | null,
	ctx: DiffContext = { kind: 'workingTree' }
): Promise<Session> {
	const repoId = repoIdFromPath(repoPath);
	const git = simpleGit(repoPath);
	// baseRef records the commit the diff was taken against, for the reviewer's
	// context: HEAD for a working-tree capture, the resolved base tip for a
	// branch capture (falling back to HEAD if it can't be resolved).
	const baseSpec = ctx.kind === 'branch' ? ctx.base : 'HEAD';
	const baseRef =
		(await git.revparse([baseSpec]).then(
			(sha) => sha.trim(),
			() => undefined
		)) ??
		(await git.revparse(['HEAD']).then(
			(sha) => sha.trim(),
			() => undefined
		));
	const branch = (await getCurrentBranch(repoPath).catch(() => null)) ?? undefined;

	// Tour steps: use the freshly authored ones, else carry over the existing
	// session's tour (re-validated below against the new file set). Either way
	// buildSteps prunes paths that aren't in the current snapshot.
	const stepInput: TourStepInput[] =
		meta.steps ??
		existing?.steps?.map((s) => ({
			title: s.title,
			body: s.body,
			files: s.paths,
			callouts: s.callouts?.map((c) => ({
				file: c.file,
				startLine: c.startLine,
				endLine: c.endLine,
				side: c.side,
				body: c.body
			}))
		})) ??
		[];

	// When a tour is present, scope the capture to exactly the files it
	// references (step files + callout files): the session then shows only the
	// changes the agent documented, not every unrelated edit sitting in the
	// working tree. With no tour (a flat session) there's nothing to scope to, so
	// we capture every changed file.
	const scopePaths = new Set(
		stepInput.flatMap((s) => [...s.files, ...(s.callouts ?? []).map((c) => c.file)])
	);
	const allChanged = await listChangedFiles(repoPath, ctx);
	const changed = scopePaths.size > 0 ? allChanged.filter((f) => scopePaths.has(f.path)) : allChanged;

	const files: SessionFile[] = [];
	let additions = 0;
	let deletions = 0;
	for (const file of changed) {
		const diff = await getDiff(repoPath, file.path, ctx);
		files.push({
			path: diff.file.path,
			oldPath: diff.file.oldPath ?? file.oldPath,
			status: diff.file.status,
			additions: diff.file.additions,
			deletions: diff.file.deletions,
			isBinary: diff.file.isBinary,
			patch: diff.patch,
			oldContents: diff.oldContents,
			newContents: diff.newContents,
			truncated: diff.truncated,
			oldImage: diff.oldImage,
			newImage: diff.newImage
		});
		additions += diff.file.additions;
		deletions += diff.file.deletions;
	}

	const knownPaths = new Set(files.map((f) => f.path));
	const steps = buildSteps(stepInput, knownPaths);

	const now = Date.now();
	return {
		id: existing?.id ?? randomUUID(),
		repoId,
		key: meta.key ?? existing?.key,
		name: meta.name ?? existing?.name ?? 'Untitled session',
		description: meta.description ?? existing?.description ?? '',
		harness: meta.harness ?? existing?.harness ?? 'other',
		harnessLabel: meta.harnessLabel ?? existing?.harnessLabel,
		harnessUrl: meta.harnessUrl ?? existing?.harnessUrl,
		branch,
		baseRef,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		fileCount: files.length,
		additions,
		deletions,
		stepCount: steps.length,
		steps,
		files
	};
}
