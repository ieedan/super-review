import type { ChangedFile, Session, SessionCallout } from '@shared/types';

// A rendered tour group: an authored step's files (in reading order), or the
// trailing synthetic group for changes no step referenced.
export interface TourGroup {
	// Step id for authored steps; "other" for the synthetic trailing group.
	id: string;
	title: string;
	body: string;
	files: ChangedFile[];
	// True for the synthetic "Other changes" group (no number, no commentary).
	synthetic: boolean;
}

// Id used for the synthetic trailing group of unassigned changes.
export const OTHER_GROUP_ID = 'other';

// Order a session's changed files into tour groups: each authored step in
// order (only the files present in the snapshot, no file twice), then a
// trailing "Other changes" group for any changed file no step referenced.
// Returns null when the session has no steps — the caller renders a flat list.
export function tourGroups(detail: Session | null, files: ChangedFile[]): TourGroup[] | null {
	if (!detail?.steps || detail.steps.length === 0) return null;
	const byPath = new Map(files.map((f) => [f.path, f]));
	const used = new Set<string>();
	const groups: TourGroup[] = [];
	for (const step of detail.steps) {
		const stepFiles: ChangedFile[] = [];
		for (const p of step.paths) {
			const f = byPath.get(p);
			if (f && !used.has(p)) {
				stepFiles.push(f);
				used.add(p);
			}
		}
		if (stepFiles.length === 0) continue;
		groups.push({
			id: step.id,
			title: step.title,
			body: step.body,
			files: stepFiles,
			synthetic: false
		});
	}
	// (callouts are looked up per-file via calloutsForFile)
	const leftover = files.filter((f) => !used.has(f.path));
	if (leftover.length > 0) {
		groups.push({
			id: OTHER_GROUP_ID,
			title: 'Other changes',
			body: '',
			files: leftover,
			synthetic: true
		});
	}
	return groups;
}

// All callouts the session pins to a given file, across every step, in step
// order. Empty when the session has no tour or none target this file.
export function calloutsForFile(detail: Session | null, path: string): SessionCallout[] {
	if (!detail?.steps) return [];
	const out: SessionCallout[] = [];
	for (const step of detail.steps) {
		for (const c of step.callouts ?? []) {
			if (c.file === path) out.push(c);
		}
	}
	return out;
}
