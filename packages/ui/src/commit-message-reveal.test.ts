import { describe, expect, it } from 'vitest';
import { carryReveal, splitStreamingMessage, stepReveal } from './commit-message-stream.js';

const FRAME = 1000 / 60;

/** Walk a fixed target to completion, reporting how long it took. */
function walk(length: number, dtMs = FRAME): { frames: number; ms: number } {
	let shown = 0;
	let frames = 0;
	while (shown < length && frames < 10_000) {
		shown = stepReveal(shown, length, dtMs);
		frames++;
	}
	return { frames, ms: frames * dtMs };
}

describe('stepReveal', () => {
	it('never runs past what has arrived', () => {
		expect(stepReveal(0, 3, 1000)).toBeLessThanOrEqual(3);
		expect(stepReveal(3, 3, FRAME)).toBe(3);
	});

	it('lands exactly, rather than asymptoting towards the end', () => {
		// The ease-out only ever closes a fraction of the gap, so the one-character
		// floor is what actually finishes the walk.
		expect(walk(3).frames).toBeLessThan(5);
	});

	it('always moves, so a slow frame cannot stall the walk', () => {
		expect(stepReveal(0, 400, 0)).toBeGreaterThanOrEqual(1);
		expect(stepReveal(0, 400, 0.01)).toBeGreaterThanOrEqual(1);
	});

	it('holds a readable pace instead of pasting a slab', () => {
		// One frame must not swallow a subject line.
		expect(stepReveal(0, 400, FRAME)).toBeLessThan(20);
		// A whole message still lands in a couple of seconds, well inside the tail
		// a real run leaves between its last token and the result event.
		const { ms } = walk(400);
		expect(ms).toBeGreaterThan(700);
		expect(ms).toBeLessThan(2500);
	});

	it('eases out rather than stopping dead', () => {
		const early = stepReveal(0, 400, FRAME);
		const late = stepReveal(397, 400, FRAME);
		expect(late).toBeLessThan(400);
		expect(late - 397).toBeLessThan(early);
	});

	it('cannot go backwards when the target shrinks under it', () => {
		expect(stepReveal(10, 4, FRAME)).toBe(4);
	});
});

describe('carryReveal', () => {
	it('carries the cursor while the answer only grows', () => {
		expect(carryReveal('feat: a', 'feat: added', 7)).toBe(7);
	});

	it('starts over when the answer is replaced rather than extended', () => {
		expect(carryReveal('feat: a', 'fix: b', 7)).toBe(0);
	});

	it('starts over when a run is cleared', () => {
		expect(carryReveal('feat: a', '', 7)).toBe(0);
	});

	it('clamps to what has arrived', () => {
		expect(carryReveal('feat', 'feat', 9)).toBe(4);
	});

	it('ignores the fraction of a character mid-walk', () => {
		expect(carryReveal('feat: a', 'feat: ab', 6.4)).toBe(6.4);
	});
});

describe('paced against the split', () => {
	// The reveal walks the raw answer, so the fields fill in the order the model
	// wrote them: Summary is still filling while Description is empty.
	it('fills the subject before the body starts', () => {
		const answer = 'feat: stream the answer\n\nPace it out.';
		const partial = answer.slice(0, 12);
		expect(splitStreamingMessage(partial)).toEqual({ subject: 'feat: stream', body: '' });
	});
});
