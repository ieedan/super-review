// Content anchors for local review comments. Browser-safe: pure string work, no
// Node imports, so the renderer and the CLI share one implementation.
//
// A comment stores `path + side + line`, which is only meaningful against the
// exact file contents it was made on. GitHub and GitLab pin a comment to a commit
// and map its line forward through a diff when the head moves. A local comment has
// no commit to pin to (the working tree is live), so we pin it to the *text*
// instead: the commented lines plus a few lines of context either side. Resolving
// finds that text again in the current file, so the comment follows the code when
// lines are added or removed above it, and goes "outdated" only when the code
// itself is gone.

// How many lines of context to keep either side of the commented block, and the
// most commented lines we keep (a longer range is matched on its head; the span is
// preserved so the end line still follows).
const CONTEXT_LINES = 3;
const MAX_BLOCK_LINES = 20;
// Longest line kept, so a minified bundle can't bloat the database.
const MAX_LINE_CHARS = 400;

// Below this combined score a candidate is not accepted as the same code.
const ACCEPT_SCORE = 0.75;
// Block weight vs. context weight in the combined score.
const BLOCK_WEIGHT = 0.7;
// Files longer than this only scan a window around the original line when fuzzy
// matching, keeping the worst case bounded.
const FUZZY_WINDOW_THRESHOLD = 20000;
const FUZZY_WINDOW = 2000;

export interface CommentAnchor {
	// The commented lines (capped to MAX_BLOCK_LINES).
	lines: string[];
	// Up to CONTEXT_LINES lines directly above / below the commented block.
	before: string[];
	after: string[];
}

export type AnchorResolution =
	// Same place it was made.
	| { status: 'exact'; startLine: number; endLine: number }
	// The identical code, now at a different line.
	| { status: 'moved'; startLine: number; endLine: number }
	// The code was edited but is still recognisably the same spot.
	| { status: 'fuzzy'; startLine: number; endLine: number }
	// The code the comment was about is gone.
	| { status: 'outdated' };

// Split file contents into lines the way the rest of the app counts them: a
// trailing newline terminates the last line rather than starting an empty one.
export function splitLines(contents: string): string[] {
	if (contents.length === 0) return [];
	const lines = contents.split('\n');
	if (lines[lines.length - 1] === '') lines.pop();
	return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function clip(line: string): string {
	return line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line;
}

// Capture the anchor for the 1-based inclusive range `startLine..endLine` of
// `contents`. Null when the range isn't inside the file (nothing to pin to).
export function captureAnchor(
	contents: string | string[],
	startLine: number,
	endLine: number
): CommentAnchor | null {
	const all = typeof contents === 'string' ? splitLines(contents) : contents;
	if (startLine < 1 || endLine < startLine || endLine > all.length) return null;
	const blockEnd = Math.min(endLine, startLine + MAX_BLOCK_LINES - 1);
	return {
		lines: all.slice(startLine - 1, blockEnd).map(clip),
		before: all.slice(Math.max(0, startLine - 1 - CONTEXT_LINES), startLine - 1).map(clip),
		after: all.slice(endLine, endLine + CONTEXT_LINES).map(clip)
	};
}

// ─── Line similarity ────────────────────────────────────────────────────────

// A line pre-digested once so comparing it against many candidates is cheap.
interface Prepped {
	te: string; // trailing whitespace trimmed
	sw: string; // all whitespace removed
	grams: Map<string, number>; // character bigrams of the whitespace-collapsed line
	glen: number; // total bigram count
}

function prep(line: string): Prepped {
	const te = line.trimEnd();
	const norm = te.trim().replace(/\s+/g, ' ');
	const grams = new Map<string, number>();
	for (let i = 0; i < norm.length - 1; i++) {
		const g = norm.slice(i, i + 2);
		grams.set(g, (grams.get(g) ?? 0) + 1);
	}
	return { te, sw: te.replace(/\s+/g, ''), grams, glen: Math.max(0, norm.length - 1) };
}

// 1 for an identical line, 0.95 when only whitespace differs, otherwise the
// Sorensen-Dice coefficient over character bigrams, dropped to 0 below 0.5 so
// unrelated lines don't add noise.
function lineSimilarity(a: Prepped, b: Prepped): number {
	if (a.te === b.te) return 1;
	if (a.sw === b.sw) return 0.95;
	if (a.sw.length < 2 || b.sw.length < 2) return 0;
	let shared = 0;
	for (const [g, n] of a.grams) shared += Math.min(n, b.grams.get(g) ?? 0);
	const d = (2 * shared) / (a.glen + b.glen);
	return d < 0.5 ? 0 : d;
}

// The file's lines, prepped lazily (only the lines a candidate actually touches).
class FileLines {
	private cache: (Prepped | undefined)[];
	constructor(readonly raw: string[]) {
		this.cache = new Array(raw.length);
	}
	get length(): number {
		return this.raw.length;
	}
	at(i: number): Prepped {
		return (this.cache[i] ??= prep(this.raw[i]));
	}
}

// Average similarity of `expected` against the file lines starting at `at`. A
// line past either end of the file contributes 0.
function runScore(expected: Prepped[], file: FileLines, at: number): number {
	if (expected.length === 0) return 1;
	let sum = 0;
	for (let i = 0; i < expected.length; i++) {
		const idx = at + i;
		if (idx >= 0 && idx < file.length) sum += lineSimilarity(expected[i], file.at(idx));
	}
	return sum / expected.length;
}

function exactRun(expected: string[], file: string[], at: number): boolean {
	if (at < 0 || at + expected.length > file.length) return false;
	for (let i = 0; i < expected.length; i++) {
		if (expected[i].trimEnd() !== file[at + i].trimEnd()) return false;
	}
	return true;
}

interface PreppedAnchor {
	lines: Prepped[];
	before: Prepped[];
	after: Prepped[];
}

// Combined score for the block starting at 0-based index `s`: the block itself
// weighted against the lines around it.
function scoreAt(anchor: PreppedAnchor, file: FileLines, s: number): number {
	const block = runScore(anchor.lines, file, s);
	const ctxLines = anchor.before.length + anchor.after.length;
	if (ctxLines === 0) return block;
	const before = runScore(anchor.before, file, s - anchor.before.length) * anchor.before.length;
	const after = runScore(anchor.after, file, s + anchor.lines.length) * anchor.after.length;
	return BLOCK_WEIGHT * block + (1 - BLOCK_WEIGHT) * ((before + after) / ctxLines);
}

// Prefer the candidate closest to where the comment was made when scores tie.
function adjusted(score: number, s: number, originalStart0: number): number {
	return score - Math.min(Math.abs(s - originalStart0), 5000) * 1e-5;
}

// Find where a comment's anchor now lives in `contents` (the current file on the
// comment's side). `stored` is the line range recorded at creation, used as the
// first guess and to break ties. Pure; runs in a few milliseconds even for large
// files.
export function resolveAnchor(
	anchor: CommentAnchor,
	stored: { startLine: number; endLine: number },
	contents: string | string[]
): AnchorResolution {
	const rawFile = typeof contents === 'string' ? splitLines(contents) : contents;
	const file = new FileLines(rawFile);
	const pa: PreppedAnchor = {
		lines: anchor.lines.map(prep),
		before: anchor.before.map(prep),
		after: anchor.after.map(prep)
	};
	const span = stored.endLine - stored.startLine;
	const blockLen = anchor.lines.length;
	if (blockLen === 0) {
		return stored.endLine <= rawFile.length
			? { status: 'exact', startLine: stored.startLine, endLine: stored.endLine }
			: { status: 'outdated' };
	}
	const origin0 = stored.startLine - 1;
	const result = (status: 'exact' | 'moved' | 'fuzzy', s0: number): AnchorResolution => ({
		status,
		startLine: s0 + 1,
		endLine: s0 + 1 + span
	});

	// Phase 1: exact copies of the block. Cheap (string equality), and covers the
	// common case of lines shifting under an unedited comment.
	const exact: number[] = [];
	for (let s = 0; s + blockLen <= rawFile.length; s++) {
		if (exactRun(anchor.lines, rawFile, s)) exact.push(s);
	}
	let best = -1;
	let bestAdj = -Infinity;
	let bestScore = 0;
	for (const s of exact) {
		const score = scoreAt(pa, file, s);
		const adj = adjusted(score, s, origin0);
		if (adj > bestAdj) {
			best = s;
			bestAdj = adj;
			bestScore = score;
		}
	}
	if (best !== -1) {
		const significant = pa.lines.reduce((n, l) => n + l.sw.length, 0) >= 8;
		// A lone copy of distinctive text is the same code even if everything
		// around it was rewritten; ambiguous or trivial text needs its context.
		if (bestScore >= ACCEPT_SCORE || (exact.length === 1 && significant)) {
			return result(best === origin0 ? 'exact' : 'moved', best);
		}
	}

	// Phase 2: fuzzy. Score every position (or a window around the original line
	// in huge files) and take the best that clears the bar.
	let from = 0;
	let to = file.length - blockLen;
	if (file.length > FUZZY_WINDOW_THRESHOLD) {
		from = Math.max(0, origin0 - FUZZY_WINDOW);
		to = Math.min(to, origin0 + FUZZY_WINDOW);
	}
	best = -1;
	bestAdj = -Infinity;
	bestScore = 0;
	for (let s = from; s <= to; s++) {
		const score = scoreAt(pa, file, s);
		if (score < ACCEPT_SCORE) continue;
		const adj = adjusted(score, s, origin0);
		if (adj > bestAdj) {
			best = s;
			bestAdj = adj;
			bestScore = score;
		}
	}
	if (best !== -1 && bestScore >= ACCEPT_SCORE) {
		return result('fuzzy', best);
	}
	return { status: 'outdated' };
}
