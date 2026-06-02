// Partial (line/hunk) staging support. Parses a unified git diff for a single
// file and rebuilds a smaller, still-valid patch that contains only the changes
// the user kept selected. The reduced patch is applied to a scratch index on
// the main process (see git-service.commit) so a commit can include a subset of
// a file's changes — GitHub Desktop's checkbox-per-line staging.
//
// Changed lines are identified by line number, which is stable across the two
// diff engines in play (git here, @pierre/diffs in the renderer): an addition by
// its line number in the new file, a deletion by its line number in the old
// file. Selection is expressed as the set of EXCLUDED line numbers per side, so
// "no exclusions" means the whole file (and newly appearing changes default to
// included), matching the whole-file inclusion model.

export type DiffSide = 'addition' | 'deletion';

export interface PatchLine {
	kind: 'context' | 'add' | 'del';
	// Content without the leading +/-/space marker and without the trailing
	// newline.
	text: string;
	// Line number in the old file (present for context and deletions).
	oldLine?: number;
	// Line number in the new file (present for context and additions).
	newLine?: number;
	// True when this line was followed by a "\ No newline at end of file" marker.
	noNewline?: boolean;
}

export interface PatchHunk {
	oldStart: number;
	oldCount: number;
	newStart: number;
	newCount: number;
	// Text after the closing `@@` on the hunk header (e.g. the enclosing
	// function), preserved verbatim.
	heading: string;
	lines: PatchLine[];
}

export interface ParsedFilePatch {
	// Raw header lines up to (not including) the first hunk: `diff --git`,
	// `index`, mode/rename lines, `---`, `+++`. Re-emitted unchanged.
	header: string[];
	hunks: PatchHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

// Build the line key the renderer and store use to track exclusions. Encodes
// the side so an addition on line N and a deletion on line N stay distinct.
export function stagingLineKey(filePath: string, side: DiffSide, line: number): string {
	return `${filePath}\u0000${side === 'addition' ? 'a' : 'd'}${line}`;
}

// Parse a single-file unified git diff. Returns null when there are no hunks
// (e.g. an empty patch, or a pure rename / binary file with nothing to stage by
// line).
export function parseFilePatch(patch: string): ParsedFilePatch | null {
	if (!patch) return null;
	const rawLines = patch.split('\n');
	// A trailing newline yields a final empty element — drop it so it isn't
	// mistaken for a zero-length context line.
	if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

	const header: string[] = [];
	const hunks: PatchHunk[] = [];
	let i = 0;

	// Everything before the first hunk header is the file header.
	while (i < rawLines.length && !HUNK_HEADER.test(rawLines[i])) {
		header.push(rawLines[i]);
		i++;
	}
	if (i >= rawLines.length) return null;

	while (i < rawLines.length) {
		const m = rawLines[i].match(HUNK_HEADER);
		if (!m) break;
		const oldStart = Number(m[1]);
		const oldCount = m[2] != null ? Number(m[2]) : 1;
		const newStart = Number(m[3]);
		const newCount = m[4] != null ? Number(m[4]) : 1;
		const heading = m[5] ?? '';
		i++;

		const lines: PatchLine[] = [];
		let oldLine = oldStart;
		let newLine = newStart;
		while (i < rawLines.length && !HUNK_HEADER.test(rawLines[i])) {
			const raw = rawLines[i];
			i++;
			if (raw.startsWith('\\')) {
				// "\ No newline at end of file" applies to the previous emitted line.
				if (lines.length > 0) lines[lines.length - 1].noNewline = true;
				continue;
			}
			const marker = raw[0] ?? ' ';
			const text = raw.slice(1);
			if (marker === '+') {
				lines.push({ kind: 'add', text, newLine });
				newLine++;
			} else if (marker === '-') {
				lines.push({ kind: 'del', text, oldLine });
				oldLine++;
			} else {
				// Treat anything else (a space, or a stray blank line git sometimes
				// emits for an empty context line) as context.
				lines.push({ kind: 'context', text, oldLine, newLine });
				oldLine++;
				newLine++;
			}
		}
		hunks.push({ oldStart, oldCount, newStart, newCount, heading, lines });
	}

	return { header, hunks };
}

// All changed-line keys in a parsed patch, so the renderer can compute select-
// all state and the store can promote a fully-deselected file to "excluded".
export function changedLineKeys(filePath: string, parsed: ParsedFilePatch): string[] {
	const keys: string[] = [];
	for (const hunk of parsed.hunks) {
		for (const line of hunk.lines) {
			if (line.kind === 'add') keys.push(stagingLineKey(filePath, 'addition', line.newLine!));
			else if (line.kind === 'del') keys.push(stagingLineKey(filePath, 'deletion', line.oldLine!));
		}
	}
	return keys;
}

// Rebuild a unified diff containing only the selected changes. `excludedAdds`
// holds new-file line numbers of additions to drop; `excludedDels` holds old-
// file line numbers of deletions to keep (rendered back as context). Returns
// null when nothing remains selected (the file should then be committed in full
// or not at all, not via a partial patch).
export function buildFilteredPatch(
	parsed: ParsedFilePatch,
	excludedAdds: Set<number>,
	excludedDels: Set<number>
): string | null {
	const out: string[] = [...parsed.header];
	let hadHunk = false;
	// Running difference between new- and old-file line counts of the hunks kept
	// so far, so each emitted hunk's `+start` stays internally consistent even
	// after we drop additions or downgrade deletions to context.
	let delta = 0;

	for (const hunk of parsed.hunks) {
		const body: string[] = [];
		let oldCount = 0;
		let newCount = 0;
		let hasChange = false;

		for (const line of hunk.lines) {
			if (line.kind === 'context') {
				body.push(` ${line.text}`);
				oldCount++;
				newCount++;
				if (line.noNewline) body.push('\\ No newline at end of file');
			} else if (line.kind === 'add') {
				if (excludedAdds.has(line.newLine!)) continue; // not added in this commit
				body.push(`+${line.text}`);
				newCount++;
				hasChange = true;
				if (line.noNewline) body.push('\\ No newline at end of file');
			} else {
				// deletion
				if (excludedDels.has(line.oldLine!)) {
					// Keep the line: render it as unchanged context.
					body.push(` ${line.text}`);
					oldCount++;
					newCount++;
				} else {
					body.push(`-${line.text}`);
					oldCount++;
					hasChange = true;
				}
				if (line.noNewline) body.push('\\ No newline at end of file');
			}
		}

		// A hunk with no remaining +/- lines is pure context — nothing to apply.
		if (!hasChange) continue;

		const newStart = hunk.oldStart + delta;
		out.push(`@@ -${hunk.oldStart},${oldCount} +${newStart},${newCount} @@${hunk.heading}`);
		out.push(...body);
		delta += newCount - oldCount;
		hadHunk = true;
	}

	if (!hadHunk) return null;
	return out.join('\n') + '\n';
}

// Split a set of line keys (all belonging to `filePath`) into the addition and
// deletion line numbers they reference. Shared by the patch builders; an
// addition key carries a new-file line number, a deletion key an old-file one.
export function lineKeySides(
	filePath: string,
	keys: Iterable<string>
): { adds: Set<number>; dels: Set<number> } {
	const adds = new Set<number>();
	const dels = new Set<number>();
	for (const k of keys) {
		// Tail after `${path}<NUL>` is a side marker ('a'/'d') plus a line number.
		const tail = k.slice(filePath.length + 1);
		const n = Number(tail.slice(1));
		if (Number.isNaN(n)) continue;
		if (tail[0] === 'a') adds.add(n);
		else if (tail[0] === 'd') dels.add(n);
	}
	return { adds, dels };
}

// Rebuild a unified diff that, applied forward to the WORKING TREE with
// `git apply`, discards the selected changes: it removes the selected additions
// (`discardAdds`, new-file line numbers) and restores the selected deletions
// (`discardDels`, old-file line numbers). Unlike buildFilteredPatch — whose base
// is HEAD — this patch's base is the working tree, so each hunk's old side is
// numbered by the new-file lines of the source diff. Kept additions stay as
// context; non-discarded deletions are absent from the working tree and so don't
// appear at all. Returns null when nothing is discarded.
export function buildDiscardPatch(
	parsed: ParsedFilePatch,
	discardAdds: Set<number>,
	discardDels: Set<number>
): string | null {
	const out: string[] = [...parsed.header];
	let hadHunk = false;
	// Running new-minus-old line difference of the hunks kept so far, so each
	// emitted hunk's `+start` stays consistent after lines are removed/restored.
	let delta = 0;

	for (const hunk of parsed.hunks) {
		const body: string[] = [];
		// Counts against the patch's base (the working tree) and result.
		let oldCount = 0;
		let newCount = 0;
		let hasChange = false;

		for (const line of hunk.lines) {
			if (line.kind === 'context') {
				body.push(` ${line.text}`);
				oldCount++;
				newCount++;
				if (line.noNewline) body.push('\\ No newline at end of file');
			} else if (line.kind === 'add') {
				if (discardAdds.has(line.newLine!)) {
					// Present in the working tree; drop it back out.
					body.push(`-${line.text}`);
					oldCount++;
					hasChange = true;
				} else {
					// Kept: still in the working tree, so it's context here.
					body.push(` ${line.text}`);
					oldCount++;
					newCount++;
				}
				if (line.noNewline) body.push('\\ No newline at end of file');
			} else {
				// deletion
				if (discardDels.has(line.oldLine!)) {
					// Absent from the working tree; add it back.
					body.push(`+${line.text}`);
					newCount++;
					hasChange = true;
					if (line.noNewline) body.push('\\ No newline at end of file');
				}
				// Otherwise the line stays deleted — not in the working tree, not in
				// the result — so it contributes nothing to this patch.
			}
		}

		// No discarded change in this hunk — emit nothing for it.
		if (!hasChange) continue;

		// The hunk's working-tree start is the source diff's new-file start.
		const oldStart = hunk.newStart;
		const newStart = oldStart + delta;
		out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${hunk.heading}`);
		out.push(...body);
		delta += newCount - oldCount;
		hadHunk = true;
	}

	if (!hadHunk) return null;
	return out.join('\n') + '\n';
}
