import { describe, it, expect } from 'vitest';
import { parseDiffFromFile } from '@pierre/diffs';
import { hunkSeenInfo } from './hunk-seen';

function lines(n: number, edit: Record<number, string> = {}): string {
	return Array.from({ length: n }, (_, i) => edit[i + 1] ?? `line ${i + 1}`).join('\n') + '\n';
}

function infoFor(oldC: string, newC: string) {
	const meta = parseDiffFromFile(
		{ name: 'a.ts', contents: oldC },
		{ name: 'a.ts', contents: newC }
	);
	return hunkSeenInfo(meta);
}

describe('hunkSeenInfo', () => {
	const base = lines(60);

	it('yields one entry per hunk, anchored on its last line', () => {
		const info = infoFor(base, lines(60, { 5: 'changed 5', 50: 'changed 50' }));
		expect(info).toHaveLength(2);
		expect(info[0].side).toBe('additions');
		expect(info[0].line).toBeLessThan(info[1].line);
		expect(info[0].hash).not.toBe(info[1].hash);
	});

	it('keeps a hunk identity when it only shifts position', () => {
		const a = infoFor(base, lines(60, { 50: 'changed 50' }));
		const shifted = 'inserted\n' + lines(60, { 50: 'changed 50' });
		const b = infoFor('inserted\n' + base, shifted);
		expect(b).toHaveLength(1);
		expect(b[0].hash).toBe(a[0].hash);
		expect(b[0].line).toBe(a[0].line + 1);
	});

	it('gives an edited hunk a new identity', () => {
		const a = infoFor(base, lines(60, { 50: 'changed 50' }));
		const b = infoFor(base, lines(60, { 50: 'changed 50 again' }));
		expect(b[0].hash).not.toBe(a[0].hash);
	});

	it('ignores edits to unchanged context lines', () => {
		const a = infoFor(base, lines(60, { 30: 'x' }));
		const b = infoFor(lines(60, { 31: 'ctx' }), lines(60, { 30: 'x', 31: 'ctx' }));
		expect(b[0].hash).toBe(a[0].hash);
	});

	it('separates identical hunks in one file by occurrence', () => {
		const old = lines(60, { 5: 'old', 50: 'old' });
		const twin = infoFor(old, lines(60, { 5: 'new', 50: 'new' }));
		expect(twin).toHaveLength(2);
		expect(twin[0].hash).not.toBe(twin[1].hash);
	});

	it('hangs a hunk that ends on a deletion off the old side', () => {
		const old = 'a\nb\nc\n';
		const info = infoFor(old, 'a\nb\n');
		expect(info).toHaveLength(1);
		expect(info[0].side).toBe('deletions');
		expect(info[0].line).toBe(3);
	});
});
