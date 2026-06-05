import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Session, Slice, SliceCallout, SliceStep } from './types.js';
import { getSlice, writeSlice } from './slice-store.js';

// Best-effort migration of the legacy frozen `.super-review/sessions/*.json`
// manifests into content-free `.super-review/slices/*.json`. Per the slices plan
// (Decision 5): keep each session's paths, steps and callouts; drop all frozen
// content (oldContents/newContents/patch/images); turn callout line ranges into
// anchors with an empty fingerprint (re-resolved lazily, then re-fingerprinted on
// the slice's next save). Originals are moved aside, never deleted automatically.

function sessionsDir(repoPath: string): string {
	return path.join(repoPath, '.super-review', 'sessions');
}

// Convert one legacy Session into a content-free Slice. Only paths + narrative +
// (fingerprint-less) anchors survive.
export function sessionToSlice(session: Session): Slice {
	const steps: SliceStep[] = (session.steps ?? []).map((s, si) => {
		const stepId = s.id ?? `step-${si + 1}`;
		const callouts: SliceCallout[] = (s.callouts ?? []).map((c, ci) => ({
			id: c.id ?? `${stepId}-c${ci + 1}`,
			anchor: {
				file: c.file,
				side: c.side === 'old' ? 'LEFT' : 'RIGHT',
				startLine: c.startLine,
				endLine: c.endLine,
				// Left empty: re-resolved against the live diff on first render
				// (trusting the hint), then re-fingerprinted on the next save.
				fingerprint: ''
			},
			body: c.body
		}));
		return { id: stepId, title: s.title, body: s.body, paths: s.paths, callouts };
	});

	return {
		id: session.id,
		repo: session.repoId,
		branch: session.branch,
		key: session.key,
		author: {
			kind: 'agent',
			name: session.harnessLabel ?? session.harness ?? 'agent',
			harness: session.harness
		},
		title: session.name,
		description: session.description,
		files: (session.files ?? []).map((f) => f.path),
		steps,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		additions: session.additions,
		deletions: session.deletions
	};
}

export interface MigrationResult {
	migrated: number;
	skipped: number;
	// Where the original sessions dir was moved, or undefined when there was
	// nothing to migrate.
	movedTo?: string;
}

// Migrate every legacy session manifest in the repo. Idempotent: a session whose
// slice already exists is skipped. After a successful pass the sessions dir is
// renamed aside (e.g. sessions.migrated-<ts>) so git sees the manifests removed
// but the originals remain on disk for safety.
export async function migrateSessionsToSlices(repoPath: string): Promise<MigrationResult> {
	const dir = sessionsDir(repoPath);
	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch {
		return { migrated: 0, skipped: 0 };
	}
	const jsons = entries.filter((n) => n.endsWith('.json'));
	if (jsons.length === 0) return { migrated: 0, skipped: 0 };

	let migrated = 0;
	let skipped = 0;
	for (const name of jsons) {
		let session: Session;
		try {
			session = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as Session;
		} catch {
			skipped++;
			continue;
		}
		if (!session?.id) {
			skipped++;
			continue;
		}
		// Idempotent: don't clobber a slice that already exists for this id.
		if (await getSlice(repoPath, session.id)) {
			skipped++;
			continue;
		}
		await writeSlice(repoPath, sessionToSlice(session));
		migrated++;
	}

	// Move the originals aside (don't delete) once everything's converted.
	const movedTo = `${dir}.migrated-${Date.now()}`;
	try {
		await fs.rename(dir, movedTo);
	} catch {
		return { migrated, skipped };
	}
	return { migrated, skipped, movedTo };
}
