import type { LocalComment } from '@super-review/core/types';

// Line count of each side of the file the diff carries. Used to decide whether a
// local comment's anchored line still exists.
export interface FileExtent {
	left: number;
	right: number;
}

// Whether a local comment's anchor has fallen out of the current diff — the
// working tree changed under it, mirroring GitHub's "outdated" flag for PR
// comments whose code has since changed.
//
// `fileDeleted` short-circuits a RIGHT-side comment: it anchors to the new file,
// which a deletion removes entirely, so the comment is outdated even before the
// (all-removed) diff loads. We know the deletion from the changed-files list, so
// this holds without the file's contents — which is why a deleted file's comment
// gets badged in the sidebar even when its section hasn't been scrolled into view
// to fetch the diff. A LEFT-side comment still points at the old contents the
// deletion renders, so it falls through to the line-extent check.
//
// `extent` is the line count of each side, or null while the diff is unloaded or
// truncated (the counts can't be trusted). When the status genuinely can't be
// told yet — no extent and the file isn't deleted — this returns `undefined` so
// callers can distinguish "still loading" from a definite not-outdated.
export function localCommentOutdated(
	comment: Pick<LocalComment, 'side' | 'startLine'>,
	opts: { fileDeleted: boolean; extent: FileExtent | null }
): boolean | undefined {
	if (opts.fileDeleted && comment.side === 'RIGHT') return true;
	if (opts.extent == null) return undefined;
	const max = comment.side === 'LEFT' ? opts.extent.left : opts.extent.right;
	return comment.startLine > max;
}
