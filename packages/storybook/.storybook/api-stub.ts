/**
 * The renderer talks to the Electron main process through `window.api`
 * (exposed by the preload via `contextBridge`). Storybook runs the components
 * in a plain browser with no preload, so we install a permissive stub before
 * any story mounts. Components call into `window.api` from `onMount`/`$effect`
 * (loading diffs, fetching PRs, opening native menus); without the stub those
 * calls throw and the component never renders.
 *
 * The stub is a recursive proxy: every namespace access (`window.api.git`,
 * `window.api.events`, ...) returns the same proxy, and calling any leaf
 * returns a "universal" value that is BOTH
 *   - thenable (so `await window.api.foo()` and `.catch(...)` resolve to
 *     `undefined`, which every caller already treats as "no data"), and
 *   - callable returning `undefined` (so subscription helpers like
 *     `window.api.events.onBranchMenuAction(cb)` hand back a usable
 *     unsubscribe function).
 *
 * Stories that need real data seed it directly into the global `app` store and
 * the diff cache (see ./store-harness), so they don't rely on this stub for
 * anything beyond "don't crash".
 */

type Universal = (() => undefined) & PromiseLike<undefined>;

function makeUniversal(): Universal {
	const fn = (() => undefined) as Universal;
	const resolved = Promise.resolve(undefined);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(fn as any).then = (onFulfilled?: any, onRejected?: any) =>
		resolved.then(onFulfilled, onRejected);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(fn as any).catch = (onRejected?: any) => resolved.catch(onRejected);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(fn as any).finally = (onFinally?: any) => resolved.finally(onFinally);
	return fn;
}

const universal = makeUniversal();

// Keys that must NOT make the namespace proxy look like a promise, an iterable,
// or a primitive — otherwise `await`, spreads, or string coercion would recurse
// into the proxy instead of resolving cleanly.
const PASSTHROUGH = new Set<PropertyKey>([
	'then',
	'catch',
	'finally',
	'toJSON',
	Symbol.toPrimitive,
	Symbol.iterator,
	Symbol.asyncIterator,
	Symbol.toStringTag
]);

const handler: ProxyHandler<() => void> = {
	get(_target, prop) {
		if (PASSTHROUGH.has(prop)) return undefined;
		return apiProxy;
	},
	apply() {
		return universal;
	}
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const apiProxy: any = new Proxy(function () {}, handler);

export function installApiStub(): void {
	if (typeof window === 'undefined') return;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const w = window as any;
	if (!w.api) w.api = apiProxy;
}
