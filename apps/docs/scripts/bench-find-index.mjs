import {
	FindIndex,
	buildSearchableFromPatch,
	searchText
} from '../../../packages/ui/src/diff-find-index.ts';
function synthPatch(hunkLines) {
	let p = '@@ -1,' + hunkLines + ' +1,' + (hunkLines + 2) + ' @@\n';
	for (let i = 0; i < hunkLines; i++) {
		const pre = i % 7 === 0 ? '+' : i % 11 === 0 ? '-' : ' ';
		p +=
			pre +
			'\tconst widget' +
			i +
			' = createWidget(widget, ' +
			i +
			'); // keep widget ' +
			i +
			' in sync\n';
	}
	return p;
}
function oldRecompute(files, query) {
	const flat = [];
	const needle = query.toLowerCase();
	for (const f of files) {
		const text = buildSearchableFromPatch(f.patch).toLowerCase();
		const m = searchText(text, needle);
		if (!m.length) continue;
		for (let i = 0; i < m.length; i++) flat.push({ filePath: f.path, idxInFile: i });
	}
	return flat.length;
}
for (const [N, hunk] of [
	[1000, 60],
	[3000, 80],
	[6000, 100]
]) {
	const files = Array.from({ length: N }, (_, k) => ({
		path: 'src/m' + (k >> 3) + '/file' + k + '.ts',
		patch: synthPatch(hunk)
	}));
	let t = performance.now();
	for (let i = 0; i < 30; i++) oldRecompute(files, 'widget');
	const oldMs = performance.now() - t;
	const idx = new FindIndex();
	idx.setOrder(files.map((f) => f.path));
	idx.setQuery('widget', false);
	t = performance.now();
	let warm = 0;
	for (let k = 0; k < N; k++) {
		idx.addFile(files[k].path, files[k].patch);
		// Force the lazy rebuild periodically, mirroring the throttled UI reading
		// the count during preload.
		if (k % 10 === 0) warm += idx.matchCount;
	}
	const total = idx.matchCount;
	const newPreloadMs = performance.now() - t;
	t = performance.now();
	idx.setQuery('widget', false);
	warm += idx.matchCount;
	const newQueryMs = performance.now() - t;
	const stride = Math.max(1, (total / 100000) | 0);
	t = performance.now();
	let sink = 0;
	for (let i = 0; i < total; i += stride) {
		const m = idx.matchAt(i);
		if (m) sink++;
	}
	const navMs = performance.now() - t;
	console.log(`N=${N}: matches=${total}`);
	console.log(`   OLD preload(30x full rescan) = ${oldMs.toFixed(0)}ms`);
	console.log(
		`   NEW preload(incremental)     = ${newPreloadMs.toFixed(0)}ms   (${(oldMs / newPreloadMs).toFixed(0)}x faster)`
	);
	console.log(`   NEW query change (rescan)    = ${newQueryMs.toFixed(0)}ms`);
	console.log(
		`   NEW ${(total / stride) | 0} matchAt() lookups = ${navMs.toFixed(1)}ms (${sink} ok, ${warm} warm)`
	);
}
