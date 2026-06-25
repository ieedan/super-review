import { describe, it, expect } from 'vitest';
import { FindIndex, buildSearchableFromPatch, searchText } from './diff-find-index';

// A real-ish unified-diff hunk: `+`/`-`/context lines, some carrying the token.
function synthPatch(token: string, hunkLines: number, fileTag: string): string {
	let p = `diff --git a/${fileTag} b/${fileTag}\n--- a/${fileTag}\n+++ b/${fileTag}\n`;
	p += `@@ -1,${hunkLines} +1,${hunkLines + 2} @@ header with ${token} that must NOT count\n`;
	for (let i = 0; i < hunkLines; i++) {
		const pre = i % 7 === 0 ? '+' : i % 11 === 0 ? '-' : ' ';
		p += `${pre}\tconst ${token}${i} = create${token}(${token}, ${i}); // keep ${token} ${i}\n`;
	}
	p += `\\ No newline at end of file\n`;
	return p;
}

// Brute-force reference: scan every file from scratch (the old algorithm) and
// build the flat list. Used to prove the incremental index agrees.
function bruteForce(
	files: { path: string; patch: string }[],
	query: string,
	caseSensitive: boolean
): { total: number; flat: { filePath: string; idxInFile: number }[] } {
	const flat: { filePath: string; idxInFile: number }[] = [];
	const needle = caseSensitive ? query : query.toLowerCase();
	for (const f of files) {
		let text = buildSearchableFromPatch(f.patch);
		if (!caseSensitive) text = text.toLowerCase();
		const m = searchText(text, needle);
		for (let i = 0; i < m.length; i++) flat.push({ filePath: f.path, idxInFile: i });
	}
	return { total: flat.length, flat };
}

describe('buildSearchableFromPatch', () => {
	it('keeps only code text, dropping headers, prefixes, and the no-newline marker', () => {
		const patch = [
			'diff --git a/x b/x',
			'--- a/x',
			'+++ b/x',
			'@@ -1,3 +1,3 @@ widget context here',
			' const a = 1;',
			'-const widget = old;',
			'+const widget = neww;',
			'\\ No newline at end of file'
		].join('\n');
		const out = buildSearchableFromPatch(patch);
		// The `@@` header line (which contains "widget") must be excluded.
		expect(out).not.toContain('context here');
		// Prefixes stripped; code retained.
		expect(out).toContain('const a = 1;');
		expect(out).toContain('const widget = old;');
		expect(out).toContain('const widget = neww;');
		// "widget" appears exactly twice in the code (once per changed line).
		expect((out.match(/widget/g) ?? []).length).toBe(2);
	});

	it('returns empty for a patch with no hunk', () => {
		expect(buildSearchableFromPatch('diff --git a/x b/x\n--- a/x\n+++ b/x\n')).toBe('');
	});
});

describe('searchText', () => {
	it('finds every non-overlapping occurrence', () => {
		expect(searchText('aXaXa'.toLowerCase(), 'x')).toEqual([
			{ start: 1, end: 2 },
			{ start: 3, end: 4 }
		]);
	});
	it('handles the empty needle and no-match', () => {
		expect(searchText('abc', '')).toEqual([]);
		expect(searchText('abc', 'z')).toEqual([]);
	});
});

describe('FindIndex correctness', () => {
	const files = [
		{ path: 'a.ts', patch: synthPatch('widget', 20, 'a.ts') },
		{ path: 'b.ts', patch: synthPatch('widget', 40, 'b.ts') },
		{ path: 'c.ts', patch: synthPatch('gadget', 30, 'c.ts') } // no "widget"
	];

	it('counts matches and maps flat index ⇄ (file, idx) consistently', () => {
		const idx = new FindIndex();
		idx.setOrder(files.map((f) => f.path));
		idx.setQuery('widget', false);
		for (const f of files) idx.addFile(f.path, f.patch);

		const ref = bruteForce(files, 'widget', false);
		expect(idx.matchCount).toBe(ref.total);
		expect(idx.matchCount).toBeGreaterThan(0);

		// Every flat slot resolves to the same (file, idx) the brute force produced.
		for (let i = 0; i < idx.matchCount; i++) {
			const m = idx.matchAt(i)!;
			expect(m).toEqual(ref.flat[i]);
			// round-trip
			expect(idx.flatIndexOf(m.filePath, m.idxInFile)).toBe(i);
		}
		// Out of range.
		expect(idx.matchAt(-1)).toBeNull();
		expect(idx.matchAt(idx.matchCount)).toBeNull();
		// A file with no matches is skipped in the flat order.
		expect(idx.firstFlatIndexForFile('c.ts')).toBe(-1);
		// First slot belongs to the first file in order that has matches.
		expect(idx.matchAt(0)!.filePath).toBe('a.ts');
	});

	it('is order-driven: flat navigation follows changed-files order', () => {
		const idx = new FindIndex();
		idx.setOrder(['b.ts', 'a.ts']); // reversed
		idx.setQuery('widget', false);
		idx.addFile('a.ts', files[0].patch);
		idx.addFile('b.ts', files[1].patch);
		// b.ts comes first now.
		expect(idx.matchAt(0)!.filePath).toBe('b.ts');
		expect(idx.firstFlatIndexForFile('a.ts')).toBe(idx.matchesForFile('b.ts').length);
	});

	it('incremental add in any order equals a one-shot brute force', () => {
		const idx = new FindIndex();
		idx.setOrder(files.map((f) => f.path));
		idx.setQuery('widget', false);
		// Add out of order, interleave matchCount reads (forces rebuilds).
		idx.addFile('c.ts', files[2].patch);
		expect(idx.matchCount).toBeGreaterThanOrEqual(0);
		idx.addFile('b.ts', files[1].patch);
		expect(idx.matchCount).toBeGreaterThanOrEqual(0); // force a rebuild mid-stream
		idx.addFile('a.ts', files[0].patch);

		const ref = bruteForce(files, 'widget', false);
		const got: { filePath: string; idxInFile: number }[] = [];
		for (let i = 0; i < idx.matchCount; i++) got.push(idx.matchAt(i)!);
		expect(got).toEqual(ref.flat);
	});

	it('rescans on query change without re-adding files (cached searchable text)', () => {
		const idx = new FindIndex();
		idx.setOrder(files.map((f) => f.path));
		idx.setQuery('widget', false);
		for (const f of files) idx.addFile(f.path, f.patch);
		const widgetCount = idx.matchCount;

		idx.setQuery('gadget', false); // only c.ts has gadget
		expect(idx.matchCount).toBe(bruteForce(files, 'gadget', false).total);
		expect(idx.matchAt(0)!.filePath).toBe('c.ts');

		idx.setQuery('widget', false); // back again, no re-add needed
		expect(idx.matchCount).toBe(widgetCount);
	});

	it('respects case sensitivity', () => {
		const idx = new FindIndex();
		idx.setOrder(['a.ts']);
		idx.addFile('a.ts', '@@ -1,1 +1,1 @@\n+Widget and widget and WIDGET\n');
		idx.setQuery('widget', false);
		expect(idx.matchCount).toBe(3); // case-insensitive
		idx.setQuery('widget', true);
		expect(idx.matchCount).toBe(1); // exact
	});

	it('setOrder drops files no longer present and clears reset everything', () => {
		const idx = new FindIndex();
		idx.setOrder(files.map((f) => f.path));
		idx.setQuery('widget', false);
		for (const f of files) idx.addFile(f.path, f.patch);
		expect(idx.hasFile('a.ts')).toBe(true);

		idx.setOrder(['b.ts']); // a.ts and c.ts removed
		expect(idx.hasFile('a.ts')).toBe(false);
		expect(idx.hasFile('b.ts')).toBe(true);
		expect(idx.matchAt(0)!.filePath).toBe('b.ts');

		idx.clear();
		expect(idx.matchCount).toBe(0);
		expect(idx.matchAt(0)).toBeNull();
	});

	it('empty query yields no matches', () => {
		const idx = new FindIndex();
		idx.setOrder(['a.ts']);
		idx.setQuery('', false);
		idx.addFile('a.ts', files[0].patch);
		expect(idx.matchCount).toBe(0);
	});

	it('ignores files without an order slot', () => {
		const idx = new FindIndex();
		idx.setOrder(['a.ts']);
		idx.setQuery('widget', false);
		idx.addFile('not-in-order.ts', files[1].patch);
		expect(idx.hasFile('not-in-order.ts')).toBe(false);
		expect(idx.matchCount).toBe(0);
	});
});

describe('FindIndex performance at scale', () => {
	function makeFiles(n: number, hunk: number) {
		return Array.from({ length: n }, (_, k) => ({
			path: `src/m${k >> 3}/file${k}.ts`,
			patch: synthPatch('widget', hunk, `file${k}.ts`)
		}));
	}

	it('indexes 5000 files incrementally (preload pattern) well under budget', () => {
		const files = makeFiles(5000, 80);
		const idx = new FindIndex();
		idx.setOrder(files.map((f) => f.path));
		idx.setQuery('widget', false);

		const t0 = performance.now();
		// Simulate preload: addFile per file, reading the count periodically (the
		// throttled UI refresh) — this is what runs on the main thread.
		for (let k = 0; k < files.length; k++) {
			idx.addFile(files[k].path, files[k].patch);
			if (k % 16 === 0) void idx.matchCount;
		}
		const total = idx.matchCount;
		const ms = performance.now() - t0;

		expect(total).toBeGreaterThan(100000);
		// The old full-rescan-per-completion approach was multiple seconds here.
		// Incremental keeps the whole preload pass comfortably interactive.
		expect(ms).toBeLessThan(1500);
	});

	it('handles a query change over 5000 cached files quickly', () => {
		const files = makeFiles(5000, 80);
		const idx = new FindIndex();
		idx.setOrder(files.map((f) => f.path));
		idx.setQuery('widget', false);
		for (const f of files) idx.addFile(f.path, f.patch);

		const t0 = performance.now();
		idx.setQuery('widget', false); // rescan all (cached searchable text)
		void idx.matchCount;
		const ms = performance.now() - t0;
		expect(ms).toBeLessThan(800);
	});

	it('navigates (matchAt) in roughly log time even with ~1.9M matches', () => {
		const files = makeFiles(5000, 80);
		const idx = new FindIndex();
		idx.setOrder(files.map((f) => f.path));
		idx.setQuery('widget', false);
		for (const f of files) idx.addFile(f.path, f.patch);
		const total = idx.matchCount;

		const t0 = performance.now();
		let ok = 0;
		const stride = Math.max(1, Math.floor(total / 100000));
		for (let i = 0; i < total; i += stride) if (idx.matchAt(i)) ok++;
		const ms = performance.now() - t0;
		expect(ok).toBeGreaterThan(0);
		expect(ms).toBeLessThan(300); // ~100k binary-search lookups
	});
});
