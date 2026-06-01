// Shared @pierre/diffs worker pool for the whole app. Syntax highlighting and
// diff-AST generation are the expensive part of painting a diff; running them
// on a pool of background workers keeps the main thread free so scrolling,
// typing in a comment composer, and tab switches stay responsive while diffs
// render.
//
// FileDiff takes the pool as its second constructor argument (see
// DiffFileSection.svelte / DiffStylePreview.svelte). On first render it lazily
// initializes the workers and rerenders when highlighted ASTs come back — the
// first synchronous paint is plain (unhighlighted) text. If the workers ever
// fail to start, FileDiff's renderer transparently falls back to the
// main-thread shared highlighter (see diff-highlighter.ts), which is why we
// keep preloading that too.
//
// Call `initDiffWorkerPool()` once at boot; `getDiffWorkerPool()` returns the
// singleton (or `undefined` when pools are unsupported / failed to start),
// suitable to hand straight to `new FileDiff(options, getDiffWorkerPool())`.

import { DEFAULT_THEMES } from '@pierre/diffs';
import {
	getOrCreateWorkerPoolSingleton,
	terminateWorkerPoolSingleton,
	type WorkerPoolManager
} from '@pierre/diffs/worker';
// Bundle Pierre's worker entry as a dedicated Web Worker via Vite's `?worker`
// suffix. We point `?worker` straight at the package's *portable* build (Shiki
// + the JS regex engine inlined, no separate `.wasm` to fetch — robust inside
// Electron's packaged `file://` renderer). Importing the file *as the worker
// entry* (rather than re-exporting it from a local module) is deliberate: the
// entry's top-level `self.addEventListener('message', …)` is always preserved,
// whereas @pierre/diffs declares `sideEffects: false`, so a side-effect-only
// re-import would be tree-shaken away into an empty, handler-less worker.
import DiffWorker from '@pierre/diffs/worker/worker-portable.js?worker';

// One Shiki highlighter is instantiated per worker (themes + languages + regex
// engine), so each worker carries real memory weight. Scale with the machine
// but cap it: a handful of workers is plenty to keep diff rendering off the
// main thread without ballooning memory on many-core boxes.
function poolSize(): number {
	const cores = navigator.hardwareConcurrency || 4;
	return Math.max(2, Math.min(4, cores - 1));
}

let pool: WorkerPoolManager | undefined;
let initialized = false;

export function initDiffWorkerPool(): void {
	if (initialized) return;
	initialized = true;
	try {
		pool = getOrCreateWorkerPoolSingleton({
			poolOptions: {
				workerFactory: () => new DiffWorker(),
				poolSize: poolSize()
			},
			highlighterOptions: {
				// `DEFAULT_THEMES` is the `{ dark, light }` pair. Passing the pair (the
				// same shape diff-highlighter.ts preloads) lets the workers emit
				// dual-theme tokens, so FileDiff can switch light/dark via its CSS
				// overlay (`setThemeType`) without re-tokenizing on the workers.
				theme: DEFAULT_THEMES,
				// Must match the main-thread highlighter (diff-highlighter.ts) so a
				// worker-rendered diff and a main-thread fallback render identically.
				langs: ['javascript', 'typescript', 'tsx', 'jsx', 'json', 'css', 'html']
			}
		});
	} catch (err) {
		// A failed pool just means diffs render on the main thread (FileDiff falls
		// back to the shared highlighter). Never let it break boot.
		console.error('[diff-worker-pool] failed to create pool:', err);
		pool = undefined;
	}
}

export function getDiffWorkerPool(): WorkerPoolManager | undefined {
	return pool;
}

export function disposeDiffWorkerPool(): void {
	if (!initialized) return;
	terminateWorkerPoolSingleton();
	pool = undefined;
	initialized = false;
}
