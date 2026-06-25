// Generates realistic DiffData fixtures for the find (Ctrl+F) debug harness.
// Each fixture is a "modified" file: we synthesize new+old contents that share
// most lines (so the diff has real context lines) and differ in a few, then run
// `git diff --no-index` to get a true unified patch. This guarantees find's
// patch-text scan and Pierre's old/new render agree on line content — the same
// invariant the real app relies on.
//
// Run: node apps/docs/scripts/gen-find-fixtures.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'lib', 'find-fixtures.json');

// The token the harness searches for. Sprinkled heavily so a single query
// produces hundreds of matches across many files — the "a lot of things" case.
const TOKEN = 'widget';

function fileBody(moduleIdx, fileIdx, lineCount) {
	const lines = [];
	lines.push(`import { ${TOKEN}Factory, create${cap(TOKEN)} } from '$lib/${TOKEN}s/core';`);
	lines.push(`import type { ${cap(TOKEN)}Props, ${cap(TOKEN)}State } from '$lib/${TOKEN}s/types';`);
	lines.push(`import { logger } from '$lib/util/log';`);
	lines.push('');
	lines.push(`// Module ${moduleIdx} file ${fileIdx}: a ${TOKEN} controller.`);
	lines.push(
		`export function setup${cap(TOKEN)}${moduleIdx}_${fileIdx}(props: ${cap(TOKEN)}Props) {`
	);
	lines.push(`	const ${TOKEN} = ${TOKEN}Factory(props);`);
	lines.push(`	let state: ${cap(TOKEN)}State = ${TOKEN}.initialState;`);
	let n = 8;
	let i = 0;
	while (n < lineCount) {
		const kind = i % 5;
		if (kind === 0) lines.push(`	const ${TOKEN}${i} = create${cap(TOKEN)}(${TOKEN}, ${i});`);
		else if (kind === 1) lines.push(`	state = ${TOKEN}.reduce(state, ${TOKEN}${i});`);
		else if (kind === 2) lines.push(`	logger.debug('${TOKEN} ${i}', ${TOKEN}${i});`);
		else if (kind === 3) lines.push(`	if (${TOKEN}.active) state.${TOKEN}Count += ${i};`);
		else lines.push(`	// keep the ${TOKEN} ${i} in sync with downstream consumers`);
		n++;
		i++;
	}
	lines.push(`	return { ${TOKEN}, state };`);
	lines.push('}');
	lines.push('');
	return lines.join('\n') + '\n';
}

function cap(s) {
	return s[0].toUpperCase() + s.slice(1);
}

// Derive an "old" version: drop a couple lines and tweak a couple so git
// produces a mix of context / deletions / additions.
function makeOld(newContents) {
	const lines = newContents.split('\n');
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		if (i === 10) continue; // a deletion
		if (i === 14) {
			out.push(lines[i].replace(/widget(\d+)/, 'oldwidget$1')); // a change
			continue;
		}
		out.push(lines[i]);
	}
	// An insertion point: the new side has an extra block the old lacks.
	return out.join('\n');
}

const tmp = mkdtempSync(join(tmpdir(), 'find-fix-'));
const fixtures = [];
let totalMatches = 0;

// 60 files across 12 modules; sizes vary so some sections are tall.
const MODULES = 12;
const FILES_PER = 5;
for (let m = 0; m < MODULES; m++) {
	for (let f = 0; f < FILES_PER; f++) {
		const lineCount = 24 + ((m * 7 + f * 13) % 140); // 24..~163 lines
		const path = `src/features/module-${String(m).padStart(2, '0')}/${TOKEN}-${f}.ts`;
		const newContents = fileBody(m, f, lineCount);
		const oldContents = makeOld(newContents);

		const oldPath = join(tmp, 'old.ts');
		const newPath = join(tmp, 'new.ts');
		writeFileSync(oldPath, oldContents);
		writeFileSync(newPath, newContents);
		let patch = '';
		try {
			execFileSync('git', ['diff', '--no-index', '--', oldPath, newPath], {
				encoding: 'utf8'
			});
		} catch (e) {
			// git diff exits 1 when files differ — that's the normal case.
			patch = e.stdout || '';
		}
		// Rewrite the temp paths in the hunk headers to the logical path so the
		// patch reads naturally (find only consumes hunk bodies, but keep it clean).
		patch = patch.replaceAll(oldPath, `a/${path}`).replaceAll(newPath, `b/${path}`);

		const additions = (patch.match(/^\+(?!\+\+)/gm) || []).length;
		const deletions = (patch.match(/^-(?!--)/gm) || []).length;
		const matches = (newContents.match(new RegExp(TOKEN, 'g')) || []).length;
		totalMatches += matches;

		fixtures.push({
			file: {
				path,
				status: 'modified',
				additions,
				deletions,
				isBinary: false
			},
			patch,
			oldContents,
			newContents,
			truncated: false
		});
	}
}

rmSync(tmp, { recursive: true, force: true });
writeFileSync(OUT, JSON.stringify({ token: TOKEN, totalMatches, fixtures }, null, '\t'));
console.log(
	`Wrote ${fixtures.length} fixtures to ${OUT} — token "${TOKEN}", ~${totalMatches} raw token occurrences (new side).`
);
