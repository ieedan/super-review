import { untrack } from 'svelte';
import { carryReveal, stepReveal } from '@super-review/ui/commit-message-stream';

/**
 * A growing string, handed back out at a readable pace.
 *
 * Wraps the cursor arithmetic in `commit-message-stream` in a frame loop: read
 * `text` for the part of the source that has been revealed so far. See the notes
 * on `stepReveal` for why anything paces this at all.
 *
 * @param source The text as it arrives. Expected to grow; a value that is not a
 *   continuation of the last one restarts the walk.
 * @param smooth Whether to pace at all. Off, `text` is the source verbatim,
 *   which is what the "no animations" setting means here.
 */
export function useStreamReveal(
	source: () => string,
	smooth: () => boolean = () => true
): { readonly text: string } {
	let shown = $state(0);
	// Deliberately not reactive: it exists to compare against the incoming value,
	// and reading it must not re-run the effect that writes it.
	let walking = '';

	$effect(() => {
		const target = source();
		const paced = smooth();

		untrack(() => {
			shown = carryReveal(walking, target, shown);
			walking = target;
		});

		if (!paced) {
			untrack(() => (shown = target.length));
			return;
		}
		if (untrack(() => shown) >= target.length) return;

		let frame = 0;
		let last = 0;
		const step = (now: number): void => {
			// The first frame of a run has nothing to measure against, so assume a
			// 60Hz tick rather than letting `now` count from the page's origin.
			const dt = last ? now - last : 16;
			last = now;
			const next = stepReveal(shown, target.length, dt);
			shown = next;
			frame = next < target.length ? requestAnimationFrame(step) : 0;
		};
		frame = requestAnimationFrame(step);

		return () => {
			if (frame) cancelAnimationFrame(frame);
		};
	});

	return {
		get text() {
			return source().slice(0, Math.floor(shown));
		}
	};
}
