// Pure, DOM-free match index for the diff-view find feature.
//
// Why this exists as its own module: the previous implementation rebuilt the
// entire index (re-parsing every cached patch into searchable text and rescanning
// it) on *every* event — and during preload that's once per file fetched. On a
// large change set (thousands of files) each rebuild is tens to hundreds of
// milliseconds, so a burst of preload completions pins the main thread for
// seconds. It also materialised a flat array with one entry per match — millions
// of objects on a big diff — and did O(n) scans over it.
//
// This index is incremental and allocation-light:
//   • Each file's *searchable text* (code-only, derived from its patch) is parsed
//     once and cached; it never changes for a given patch.
//   • Adding a file scans just that file. Changing the query rescans every file
//     but only re-runs indexOf over the cached text — no re-parsing.
//   • The flat match list is never materialised. We keep, per file, just the
//     match COUNT plus a prefix-sum over the files that have matches, so
//     `matchAt(flatIndex)` is a binary search and `flatIndexOf` is O(log files).
//
// It is deliberately framework- and DOM-agnostic so it can be unit tested and
// benchmarked in plain Node. The Svelte controller (diff-find.svelte.ts) owns
// the reactive state, DOM ranges and navigation; it drives this index.

export interface PatchMatch {
	start: number;
	end: number;
}

export interface FlatMatch {
	filePath: string;
	idxInFile: number;
}

// Pull just the code text out of a unified diff: drop hunk headers ("@@ … @@")
// and the "\ No newline at end of file" marker, and strip the leading +/-/space
// so a query matches the visible code, not the diff metadata.
export function buildSearchableFromPatch(patch: string): string {
	const lines = patch.split('\n');
	const out: string[] = [];
	let inHunk = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith('@@ ')) {
			inHunk = true;
			continue;
		}
		if (!inHunk) continue;
		if (line.startsWith('\\')) continue;
		const ch = line.length > 0 ? line[0] : '';
		if (ch === '+' || ch === '-' || ch === ' ') out.push(line.slice(1));
		else out.push(line);
	}
	return out.join('\n');
}

// All occurrences of `query` in `text`. Caller lower-cases both for an
// insensitive search; we don't re-lower here so the hot path stays allocation
// free across repeated calls on the same cached text.
export function searchText(hay: string, needle: string): PatchMatch[] {
	if (!needle) return [];
	const results: PatchMatch[] = [];
	let idx = 0;
	const step = Math.max(needle.length, 1);
	while (true) {
		const f = hay.indexOf(needle, idx);
		if (f < 0) break;
		results.push({ start: f, end: f + needle.length });
		idx = f + step;
	}
	return results;
}

interface FileEntry {
	// The code-only searchable text, parsed once from the patch and cached. Stored
	// lower-cased lazily alongside the original so a case-insensitive query reuses it.
	raw: string;
	lower: string | null;
	matches: PatchMatch[];
}

export class FindIndex {
	private files = new Map<string, FileEntry>();
	// File paths in changed-files order — defines flat navigation order.
	private order: string[] = [];
	private orderRank = new Map<string, number>();

	private query = '';
	private caseSensitive = false;

	// Files that currently have ≥1 match, in `order`, with a prefix sum of their
	// match counts. `prefix[i]` is the number of matches in filesWithMatches[0..i).
	// Rebuilt lazily (O(files-with-matches)) whenever the index is marked dirty —
	// never per-match, so it stays cheap even with millions of matches.
	private filesWithMatches: string[] = [];
	private prefix: number[] = [];
	private total = 0;
	private dirty = false;

	// Set the file ordering (from app.changedFiles). Files not in the new order
	// are dropped. Preserves cached searchable text + matches for surviving files.
	setOrder(paths: string[]): void {
		this.order = paths.slice();
		this.orderRank = new Map(paths.map((p, i) => [p, i]));
		for (const path of [...this.files.keys()]) {
			if (!this.orderRank.has(path)) this.files.delete(path);
		}
		this.dirty = true;
	}

	// Change the search term. Rescans every known file, but only re-runs indexOf
	// over already-parsed searchable text — no patch re-parsing.
	setQuery(query: string, caseSensitive: boolean): void {
		this.query = query;
		this.caseSensitive = caseSensitive;
		const needle = caseSensitive ? query : query.toLowerCase();
		for (const entry of this.files.values()) {
			entry.matches = this.scan(entry, needle);
		}
		this.dirty = true;
	}

	// Add (or replace) a file's patch. Parses + caches its searchable text once
	// and scans only this file against the current query. Cheap and incremental —
	// this is the call preload makes per fetched file.
	addFile(path: string, patch: string): void {
		if (!this.orderRank.has(path)) {
			// A file we don't have an order slot for can't be navigated to; ignore
			// until setOrder includes it (keeps flat indices well-defined).
			return;
		}
		const raw = buildSearchableFromPatch(patch);
		const entry: FileEntry = { raw, lower: null, matches: [] };
		const needle = this.caseSensitive ? this.query : this.query.toLowerCase();
		entry.matches = this.scan(entry, needle);
		this.files.set(path, entry);
		this.dirty = true;
	}

	hasFile(path: string): boolean {
		return this.files.has(path);
	}

	clear(): void {
		this.files.clear();
		this.filesWithMatches = [];
		this.prefix = [];
		this.total = 0;
		this.dirty = false;
	}

	private scan(entry: FileEntry, needle: string): PatchMatch[] {
		if (!needle) return [];
		let hay = entry.raw;
		if (!this.caseSensitive) {
			if (entry.lower === null) entry.lower = entry.raw.toLowerCase();
			hay = entry.lower;
		}
		return searchText(hay, needle);
	}

	private rebuild(): void {
		if (!this.dirty) return;
		this.dirty = false;
		this.filesWithMatches = [];
		this.prefix = [];
		let acc = 0;
		for (const path of this.order) {
			const entry = this.files.get(path);
			if (!entry || entry.matches.length === 0) continue;
			this.filesWithMatches.push(path);
			this.prefix.push(acc);
			acc += entry.matches.length;
		}
		this.total = acc;
	}

	get matchCount(): number {
		this.rebuild();
		return this.total;
	}

	matchesForFile(path: string): PatchMatch[] {
		return this.files.get(path)?.matches ?? [];
	}

	// flat index → {file, idxInFile} via binary search over the prefix sums.
	matchAt(flatIndex: number): FlatMatch | null {
		this.rebuild();
		if (flatIndex < 0 || flatIndex >= this.total) return null;
		// Find the last file whose prefix start is ≤ flatIndex.
		let lo = 0;
		let hi = this.prefix.length - 1;
		let fileIdx = 0;
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			if (this.prefix[mid] <= flatIndex) {
				fileIdx = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		return {
			filePath: this.filesWithMatches[fileIdx],
			idxInFile: flatIndex - this.prefix[fileIdx]
		};
	}

	// {file, idxInFile} → flat index, or -1 if that file/match isn't in the index.
	flatIndexOf(filePath: string, idxInFile: number): number {
		this.rebuild();
		// Linear over filesWithMatches would be O(files); binary search keeps it
		// O(log files) by exploiting that filesWithMatches is in `order`.
		const rank = this.orderRank.get(filePath);
		if (rank === undefined) return -1;
		let lo = 0;
		let hi = this.filesWithMatches.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			const midRank = this.orderRank.get(this.filesWithMatches[mid])!;
			if (midRank === rank) {
				const entry = this.files.get(filePath);
				if (!entry || idxInFile < 0 || idxInFile >= entry.matches.length) return -1;
				return this.prefix[mid] + idxInFile;
			}
			if (midRank < rank) lo = mid + 1;
			else hi = mid - 1;
		}
		return -1;
	}

	// First flat index of a file's matches, or -1.
	firstFlatIndexForFile(filePath: string): number {
		return this.flatIndexOf(filePath, 0);
	}
}
