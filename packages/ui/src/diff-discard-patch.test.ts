import { describe, expect, it } from 'vitest';
import {
	buildDiscardPatch,
	lineKeySides,
	parseFilePatch,
	stagingLineKey
} from '@super-review/core/diff-staging';

// buildDiscardPatch applies to the WORKING TREE, so its patch must always read as
// an in-place modification of an existing file. The tricky input is an untracked
// file, whose source diff is a synthesized "new file" patch. If the discard patch
// keeps that creation header, git apply rejects it with "new file X depends on old
// contents" (the file already exists on disk). These tests pin the header down.

const NEW_FILE_PATH = 'packages/helpers/README.md';

// What getDiff's synthesizeAddedFilePatch emits for an untracked file.
const syntheticAddedPatch = [
	`diff --git a/${NEW_FILE_PATH} b/${NEW_FILE_PATH}`,
	'new file mode 100644',
	'--- /dev/null',
	`+++ b/${NEW_FILE_PATH}`,
	'@@ -0,0 +1,3 @@',
	'+line one',
	'+line two',
	'+line three',
	''
].join('\n');

describe('buildDiscardPatch header for a new/untracked file', () => {
	const parsed = parseFilePatch(syntheticAddedPatch)!;
	const { adds, dels } = lineKeySides(NEW_FILE_PATH, [
		stagingLineKey(NEW_FILE_PATH, 'addition', 2)
	]);
	const patch = buildDiscardPatch(parsed, adds, dels)!;

	it('drops the creation markers so git apply treats it as a modification', () => {
		expect(patch).not.toContain('new file mode');
		expect(patch).not.toContain('--- /dev/null');
	});

	it('points the old side at the real working-tree path', () => {
		expect(patch).toContain(`--- a/${NEW_FILE_PATH}`);
		expect(patch).toContain(`+++ b/${NEW_FILE_PATH}`);
	});

	it('removes the discarded line while keeping the rest as context', () => {
		expect(patch).toContain('-line two');
		expect(patch).toContain(' line one');
		expect(patch).toContain(' line three');
	});
});

describe('buildDiscardPatch header for a normal modified file', () => {
	// A normal modified file already has real `a/`..`b/` sides; the header must pass
	// through untouched so we never alter a patch that was already valid.
	const modifiedPatch = [
		'diff --git a/src/app.ts b/src/app.ts',
		'index 1111111..2222222 100644',
		'--- a/src/app.ts',
		'+++ b/src/app.ts',
		'@@ -1,2 +1,3 @@',
		' a',
		'+b2',
		' b',
		''
	].join('\n');
	const parsed = parseFilePatch(modifiedPatch)!;
	const { adds, dels } = lineKeySides('src/app.ts', [stagingLineKey('src/app.ts', 'addition', 2)]);
	const patch = buildDiscardPatch(parsed, adds, dels)!;

	it('keeps the original modification header intact', () => {
		expect(patch).toContain('--- a/src/app.ts');
		expect(patch).toContain('+++ b/src/app.ts');
		expect(patch).toContain('index 1111111..2222222 100644');
		expect(patch).toContain('-b2');
	});
});
