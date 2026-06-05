import { resolveAnchor } from '@super-review/core/anchor';
import type { ChangedFile, DiffData, Slice, SliceCallout } from '@shared/types';

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

// A callout resolved against the live diff: its anchor re-found (possibly
// shifted) and projected back onto a side + line range the diff view can render,
// or flagged `outdated` when its line text is gone. Mirrors the fields the
// callout annotation needs, decoupled from the stored anchor shape.
export interface ResolvedCallout {
	id: string;
	side: 'old' | 'new';
	startLine: number;
	endLine: number;
	body: string;
	// True when the anchor's fingerprinted text no longer exists on its side, so
	// the range is the stale hint and the UI should mark it as such.
	outdated: boolean;
}

// Id used for the synthetic trailing group of unassigned changes.
export const OTHER_GROUP_ID = 'other';

// Order a slice's changed files into tour groups: each authored step in order
// (only the files present in the live diff, no file twice), then a trailing
// "Other changes" group for any changed file no step referenced. Returns null
// when the slice has no steps — the caller renders a flat list.
export function tourGroups(detail: Slice | null, files: ChangedFile[]): TourGroup[] | null {
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

// Flatten a slice's tour into the file order the diff view renders: each
// authored step's files (reading order) followed by the trailing "Other
// changes". Returns null when the slice has no tour, so callers fall back to
// the changes-view order.
export function tourFileOrder(detail: Slice | null, files: ChangedFile[]): ChangedFile[] | null {
	const groups = tourGroups(detail, files);
	if (!groups) return null;
	return groups.flatMap((g) => g.files);
}

// All callouts the slice pins to a given file, across every step, in step order.
// Empty when the slice has no tour or none target this file. The returned
// callouts still carry their stored anchors — resolve them with
// `resolveCallouts` once the file's live diff content is available.
export function calloutsForFile(detail: Slice | null, path: string): SliceCallout[] {
	if (!detail?.steps) return [];
	const out: SliceCallout[] = [];
	for (const step of detail.steps) {
		for (const c of step.callouts ?? []) {
			if (c.anchor.file === path) out.push(c);
		}
	}
	return out;
}

// Project a file's callouts onto the live diff: resolve each anchor against the
// matching side's current contents, yielding a render-ready range (or the stale
// hint flagged `outdated`). Returns [] until the diff content is available, so
// callouts surface only once there's a diff to anchor them to.
export function resolveCallouts(
	callouts: SliceCallout[],
	diff: DiffData | null
): ResolvedCallout[] {
	if (!diff) return [];
	return callouts.map((c) => {
		const sideContents = c.anchor.side === 'LEFT' ? diff.oldContents : diff.newContents;
		const side: 'old' | 'new' = c.anchor.side === 'LEFT' ? 'old' : 'new';
		const res = resolveAnchor(c.anchor, sideContents);
		if (res.state === 'anchored') {
			return {
				id: c.id,
				side,
				startLine: res.startLine,
				endLine: res.endLine,
				body: c.body,
				outdated: false
			};
		}
		return {
			id: c.id,
			side,
			startLine: c.anchor.startLine,
			endLine: c.anchor.endLine,
			body: c.body,
			outdated: true
		};
	});
}
