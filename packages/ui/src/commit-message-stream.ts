/**
 * Splitting a half-written commit message for display.
 *
 * The agent answers with the message itself: subject on the first line, blank
 * line, then the body. Mid-stream that means everything up to the first newline
 * is the subject (still growing), and everything after the blank line is the
 * body. The main process runs the strict parser on the finished text — this one
 * only has to be right enough to render, and never throw away characters.
 */
export interface StreamingMessage {
	subject: string;
	body: string;
}

export function splitStreamingMessage(answer: string): StreamingMessage {
	const text = answer.replace(/\r\n/g, '\n');
	if (!text.trim()) return { subject: '', body: '' };

	const lines = text.split('\n');
	let i = 0;
	while (i < lines.length && !lines[i]!.trim()) i++;

	// Drop a label a model sometimes leads with, the same way the final parse does.
	const subject = (lines[i] ?? '').replace(
		/^\s*(?:subject|title|commit(?:\s+message)?)\s*:\s*/i,
		''
	);
	const body = lines
		.slice(i + 1)
		.join('\n')
		.replace(/^\s*(?:body|description)\s*:\s*/i, '')
		.trim();

	return { subject: subject.trim(), body };
}

/**
 * Pacing the answer back out at a readable speed.
 *
 * Nothing between the model and this box streams a token at a time. The harness
 * CLIs report partial messages in slabs — a measured Claude Code run answered a
 * ~400 character message in six deltas, and the first one already held the whole
 * subject line — and the reporter in main coalesces further, to one IPC message
 * per 50ms. So the subject does not type itself in: it lands whole, in one
 * frame, which is what "it applies instantly" looks like.
 *
 * The fix belongs here rather than in any one adapter: every harness batches,
 * just at its own granularity, and two of them (Copilot, OpenCode) fall back to
 * re-sending all of stdout. So the box treats whatever has arrived as a target
 * and walks a cursor towards it, character by character, on a frame timer.
 *
 * The walk is capped at a readable pace and eases out as it catches up, so a
 * slab of sixty characters reads as writing rather than a paste. It runs over
 * the raw answer, before the subject/body split, so the fields fill in the order
 * the model wrote them.
 */

/** Fastest the cursor moves, in characters per second. */
const REVEAL_CHARS_PER_SEC = 320;
/**
 * Time constant for the ease-out. Once the backlog is small enough that this
 * curve is slower than the cap, the last few characters decelerate instead of
 * stopping dead.
 */
const REVEAL_TAU_MS = 130;

/**
 * How far the cursor moves this frame.
 *
 * @param shown Characters revealed so far.
 * @param length Characters available to reveal.
 * @param dtMs Time since the last frame.
 * @returns The new count, never past `length` and never standing still.
 */
export function stepReveal(shown: number, length: number, dtMs: number): number {
	const remaining = length - shown;
	if (remaining <= 0) return Math.min(shown, length);

	const eased = remaining * (1 - Math.exp(-Math.max(0, dtMs) / REVEAL_TAU_MS));
	const capped = (REVEAL_CHARS_PER_SEC * Math.max(0, dtMs)) / 1000;
	// At least one character a frame, or a slow frame rate could stall the walk.
	const advance = Math.max(1, Math.min(eased, capped));
	return Math.min(length, shown + advance);
}

/**
 * Where to restart the cursor when the answer text changes.
 *
 * The answer normally only grows, so the cursor carries over. It does not grow
 * when a run is cleared or an adapter retries and resets the reporter, and
 * replaying the old prefix against new text would show characters the model
 * never wrote — so anything that is not a continuation starts over.
 *
 * @param previous The answer the cursor was walking.
 * @param next The answer that just arrived.
 * @param shown Characters revealed so far.
 */
export function carryReveal(previous: string, next: string, shown: number): number {
	if (!next.startsWith(previous.slice(0, Math.floor(shown)))) return 0;
	return Math.min(shown, next.length);
}
