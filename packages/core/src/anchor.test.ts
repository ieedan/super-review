import { describe, it, expect } from 'vitest';
import { computeFingerprint, makeAnchor, resolveAnchor, type Anchor } from './anchor';

// The fixture file the anchors below were captured against. Line 2 ("beta") is
// the single-line target; lines 2-3 ("beta"/"gamma") the multi-line target.
const ORIGINAL = ['alpha', 'beta', 'gamma', 'delta'].join('\n') + '\n';

function anchorFor(start: number, end: number, contents = ORIGINAL): Anchor {
	const a = makeAnchor('src/file.ts', 'RIGHT', start, end, contents);
	if (!a) throw new Error(`could not anchor ${start}-${end}`);
	return a;
}

describe('computeFingerprint', () => {
	it('is stable for the same lines and differs for different lines', () => {
		expect(computeFingerprint(['beta'])).toBe(computeFingerprint(['beta']));
		expect(computeFingerprint(['beta'])).not.toBe(computeFingerprint(['gamma']));
	});

	it('treats a multi-line run as one unit', () => {
		expect(computeFingerprint(['beta', 'gamma'])).not.toBe(computeFingerprint(['beta']));
	});
});

describe('makeAnchor', () => {
	it('rejects an out-of-bounds range', () => {
		expect(makeAnchor('f', 'RIGHT', 10, 10, ORIGINAL)).toBeNull();
		expect(makeAnchor('f', 'RIGHT', 2, 1, ORIGINAL)).toBeNull();
	});

	it('captures the fingerprint of the targeted lines', () => {
		const a = anchorFor(2, 2);
		expect(a.fingerprint).toBe(computeFingerprint(['beta']));
	});
});

describe('resolveAnchor', () => {
	it('anchors unchanged content at the original line', () => {
		const a = anchorFor(2, 2);
		expect(resolveAnchor(a, ORIGINAL)).toEqual({ state: 'anchored', startLine: 2, endLine: 2 });
	});

	it('follows a line inserted above (shifts down)', () => {
		const a = anchorFor(2, 2);
		const edited = ['zero', 'alpha', 'beta', 'gamma', 'delta'].join('\n') + '\n';
		expect(resolveAnchor(a, edited)).toEqual({ state: 'anchored', startLine: 3, endLine: 3 });
	});

	it('follows a line removed above (shifts up)', () => {
		const a = anchorFor(3, 3); // "gamma"
		const edited = ['beta', 'gamma', 'delta'].join('\n') + '\n';
		expect(resolveAnchor(a, edited)).toEqual({ state: 'anchored', startLine: 2, endLine: 2 });
	});

	it('marks an edited line outdated', () => {
		const a = anchorFor(2, 2);
		const edited = ['alpha', 'BETA-changed', 'gamma', 'delta'].join('\n') + '\n';
		expect(resolveAnchor(a, edited)).toEqual({ state: 'outdated' });
	});

	it('marks a missing file outdated', () => {
		const a = anchorFor(2, 2);
		expect(resolveAnchor(a, '')).toEqual({ state: 'outdated' });
	});

	it('anchors a multi-line run and follows its shift', () => {
		const a = anchorFor(2, 3); // "beta"/"gamma"
		const edited = ['zero', 'one', 'alpha', 'beta', 'gamma', 'delta'].join('\n') + '\n';
		expect(resolveAnchor(a, edited)).toEqual({ state: 'anchored', startLine: 4, endLine: 5 });
	});

	it('marks a multi-line run outdated when only part survives', () => {
		const a = anchorFor(2, 3); // "beta"/"gamma"
		const edited = ['alpha', 'beta', 'GAMMA-changed', 'delta'].join('\n') + '\n';
		expect(resolveAnchor(a, edited)).toEqual({ state: 'outdated' });
	});

	it('is insensitive to a trailing-newline-only difference', () => {
		const a = anchorFor(4, 4); // "delta", last line
		const noTrailing = ['alpha', 'beta', 'gamma', 'delta'].join('\n');
		expect(resolveAnchor(a, noTrailing)).toEqual({ state: 'anchored', startLine: 4, endLine: 4 });
	});

	it('is insensitive to CRLF vs LF line endings', () => {
		const a = anchorFor(2, 2);
		const crlf = ['alpha', 'beta', 'gamma', 'delta'].join('\r\n') + '\r\n';
		expect(resolveAnchor(a, crlf)).toEqual({ state: 'anchored', startLine: 2, endLine: 2 });
	});
});
