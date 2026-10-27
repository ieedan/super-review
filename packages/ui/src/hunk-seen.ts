import type { FileDiffMetadata } from '@pierre/diffs';

// Identity of a hunk for the per-hunk "Mark seen" buttons. The hash covers only
// the changed lines (not line numbers, not context), so:
//  - editing a hunk's changes gives it a new identity and it resurfaces, matching
//    how a changed file loses its seen mark;
//  - a hunk that merely shifts down because lines were added above it stays seen;
//  - an edit to a nearby unchanged line doesn't reset it.
// Two hunks with identical changes in one file are told apart by occurrence.

// cyrb53: fast, well-distributed, non-cryptographic 53-bit hash. We only need
// "different content gives a different key with overwhelming likelihood".
function hashText(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface HunkSeenInfo {
	hash: string;
	// Where the hunk's "Mark seen" bar hangs: just below the hunk's last line, on
	// the side that line belongs to.
	side: 'additions' | 'deletions';
	line: number;
}

type Meta = Pick<FileDiffMetadata, 'hunks' | 'additionLines' | 'deletionLines'>;

export function hunkSeenInfo(meta: Meta): HunkSeenInfo[] {
	const out: HunkSeenInfo[] = [];
	const occurrences = new Map<string, number>();
	for (const hunk of meta.hunks) {
		let text = '';
		for (const block of hunk.hunkContent) {
			if (block.type !== 'change') continue;
			for (let i = 0; i < block.deletions; i++) {
				text += `-${meta.deletionLines[block.deletionLineIndex + i] ?? ''}\n`;
			}
			for (let i = 0; i < block.additions; i++) {
				text += `+${meta.additionLines[block.additionLineIndex + i] ?? ''}\n`;
			}
			text += '@@\n';
		}
		// A hunk with no change blocks has nothing to review.
		if (!text) continue;
		const base = hashText(text);
		const n = occurrences.get(base) ?? 0;
		occurrences.set(base, n + 1);
		const hash = n === 0 ? base : `${base}#${n}`;

		// A hunk ending on deletions only has no new-side line to hang the bar on.
		const last = hunk.hunkContent[hunk.hunkContent.length - 1];
		const endsOnDeletion =
			hunk.additionCount === 0 || (last?.type === 'change' && last.additions === 0);
		if (endsOnDeletion && hunk.deletionCount > 0) {
			out.push({ hash, side: 'deletions', line: hunk.deletionStart + hunk.deletionCount - 1 });
		} else {
			out.push({ hash, side: 'additions', line: hunk.additionStart + hunk.additionCount - 1 });
		}
	}
	return out;
}
