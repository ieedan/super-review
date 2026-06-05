// Drift-following anchors — the foundation of the "slices store no code" model.
//
// A slice (and a local comment) never freezes file content; it remembers *where*
// it pointed and *what the text was* (a fingerprint), then re-finds that text in
// the live diff every time it renders. The line numbers are only a hint — the
// fingerprint is the truth. When the fingerprinted text still exists the anchor
// resolves (possibly at a shifted line); when it's gone the anchor is "outdated"
// and the UI surfaces it as such rather than pointing at the wrong place.
//
// Resolution is deliberately conservative: exact line-content match or nothing.
// Fuzzy matching is later polish — a flaky resolver that silently jumps a callout
// to the wrong lines is worse than one that honestly says "outdated".
//
// This module is intentionally dependency-free (no node:* imports) so it runs
// unchanged in the Electron renderer as well as the node CLI/main process: the
// renderer re-resolves anchors against live diff content on every render.

export interface Anchor {
	// Repo-relative, posix path of the file the anchor lives in.
	file: string;
	// Which side of the diff the line numbers refer to: 'RIGHT' = the new file
	// (additions), 'LEFT' = the original (deletions). Matches GitHub's REST API
	// and the existing comment/PR conventions.
	side: 'LEFT' | 'RIGHT';
	// 1-based inclusive line range, a *hint* for where the text used to be. A
	// single-line anchor has startLine === endLine.
	startLine: number;
	endLine: number;
	// Hash of the anchored line text(s) — the source of truth. As long as this
	// exact run of lines still exists somewhere on `side`, the anchor resolves.
	fingerprint: string;
}

export type Resolved =
	// Found — possibly shifted from the original hint. The range is where the
	// fingerprinted text currently lives.
	| { state: 'anchored'; startLine: number; endLine: number }
	// The fingerprinted text is gone (edited, or the file no longer exists).
	| { state: 'outdated' };

// Hash a run of lines into the fingerprint stored on an anchor. Lines are joined
// with "\n" so the fingerprint covers the multi-line text exactly; CRLF is
// normalized away first so a line-ending flip alone doesn't strand an anchor.
//
// The hash is a pure-JS cyrb53 (no crypto dependency) so the same code runs in
// the renderer and node. It isn't cryptographic — it only needs enough collision
// resistance to tell whether a line's text changed, which cyrb53's 53 bits give
// comfortably for source lines.
export function computeFingerprint(lines: string[]): string {
	const str = lines.join('\n');
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
	return hash.toString(16).padStart(14, '0');
}

// Split a file's contents into its lines, dropping the single trailing empty
// element a final newline produces — so "a\nb\n" and "a\nb" both yield
// ['a', 'b'] and line N always refers to the same text. CRLF is normalized so
// fingerprints match regardless of line endings.
function splitLines(contents: string): string[] {
	if (contents === '') return [];
	const lines = contents.replace(/\r\n/g, '\n').split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
	return lines;
}

// Re-find an anchor in the current contents of its side. Tries the stored hint
// first (the common case — nothing moved), then scans outward symmetrically for
// an exact content match (a line inserted/removed above shifts the range), and
// gives up as "outdated" when the fingerprinted text can't be found at all.
export function resolveAnchor(a: Anchor, currentSideContents: string): Resolved {
	const span = a.endLine - a.startLine + 1;
	if (span <= 0) return { state: 'outdated' };

	const lines = splitLines(currentSideContents);
	if (lines.length < span) return { state: 'outdated' };

	// An empty fingerprint means "not yet computed" — migrated callouts carry the
	// old line range as a hint with no captured text. Trust the hint when it's in
	// range (it's re-fingerprinted on the next save); otherwise it's outdated.
	if (a.fingerprint === '') {
		if (a.startLine >= 1 && a.endLine <= lines.length) {
			return { state: 'anchored', startLine: a.startLine, endLine: a.endLine };
		}
		return { state: 'outdated' };
	}

	const matchesAt = (start1: number): boolean => {
		const start0 = start1 - 1;
		if (start0 < 0 || start0 + span > lines.length) return false;
		return computeFingerprint(lines.slice(start0, start0 + span)) === a.fingerprint;
	};

	// 1. The hint — by far the common case (the line didn't move).
	if (matchesAt(a.startLine)) {
		return { state: 'anchored', startLine: a.startLine, endLine: a.startLine + span - 1 };
	}

	// 2. Scan outward from the hint, nearest first, so the closest match to where
	//    the text used to be wins when (unlikely) the same run appears twice.
	for (let off = 1; off <= lines.length; off++) {
		const down = a.startLine + off;
		if (matchesAt(down)) {
			return { state: 'anchored', startLine: down, endLine: down + span - 1 };
		}
		const up = a.startLine - off;
		if (up >= 1 && matchesAt(up)) {
			return { state: 'anchored', startLine: up, endLine: up + span - 1 };
		}
	}

	return { state: 'outdated' };
}

// Build an anchor from a side's current contents and a line range — the capture-
// time helper that stamps the fingerprint. Returns null when the range is out of
// bounds for the given contents (nothing to anchor to).
export function makeAnchor(
	file: string,
	side: 'LEFT' | 'RIGHT',
	startLine: number,
	endLine: number,
	sideContents: string
): Anchor | null {
	const span = endLine - startLine + 1;
	if (span <= 0) return null;
	const lines = splitLines(sideContents);
	if (startLine < 1 || endLine > lines.length) return null;
	const fingerprint = computeFingerprint(lines.slice(startLine - 1, endLine));
	return { file, side, startLine, endLine, fingerprint };
}
