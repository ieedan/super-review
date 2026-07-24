import { createHash } from 'node:crypto';
import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import WebSocket from 'ws';

// The Convex `licensing.watchToken` query, referenced by name so the desktop
// doesn't have to depend on the web app's generated API types. Returns an opaque
// string that changes whenever the license behind this device token changes.
const watchTokenRef = makeFunctionReference<'query', { tokenHash: string }, string>(
	'licensing:watchToken'
);

let client: ConvexClient | null = null;
let unsubscribe: (() => void) | null = null;
let watchedUrl: string | null = null;
let watchedKey: string | null = null;
// The last signal we've seen. The first delivery after subscribing is the
// current snapshot (we've just validated against it), so it establishes the
// baseline without triggering a revalidation.
let lastSignal: string | null = null;
let haveBaseline = false;

/** Same hashing the server applies before looking the token up (see
 * license-token.ts `sha256Hex`), so we can address the watch query by the token
 * hash and never send the raw device token to Convex. */
function tokenHash(deviceToken: string): string {
	return createHash('sha256').update(deviceToken).digest('hex');
}

/**
 * Open (or keep) a realtime Convex subscription for this device token. When the
 * license behind it changes - a purchase, refund, plan change, suspension, or
 * device revocation - `onChange` fires so the caller can revalidate immediately
 * instead of waiting for the periodic poll. Idempotent: re-calling with the same
 * url + token is a no-op, so it's safe to call after every validation.
 */
export function ensureLicenseWatch(
	convexUrl: string,
	deviceToken: string,
	onChange: () => void
): void {
	const key = tokenHash(deviceToken);
	if (client && watchedUrl === convexUrl && watchedKey === key) return;

	stopLicenseWatch();
	watchedUrl = convexUrl;
	watchedKey = key;

	let c: ConvexClient;
	try {
		// Electron's main process (Node 20) has no global WebSocket, so hand Convex
		// the `ws` implementation explicitly.
		c = new ConvexClient(convexUrl, {
			webSocketConstructor: WebSocket as unknown as typeof globalThis.WebSocket
		});
	} catch {
		watchedUrl = null;
		watchedKey = null;
		return;
	}
	client = c;

	const sub = c.onUpdate(
		watchTokenRef,
		{ tokenHash: key },
		(signal) => {
			const s = String(signal);
			if (!haveBaseline) {
				haveBaseline = true;
				lastSignal = s;
				return;
			}
			if (s === lastSignal) return;
			lastSignal = s;
			onChange();
		},
		() => {
			// Swallow subscription errors: the periodic poll remains the backstop, so
			// a transient Convex error must never break licensing.
		}
	);
	// onUpdate returns an Unsubscribe (callable, with an `unsubscribe` method).
	unsubscribe = () => sub.unsubscribe();
}

/** Tear down any open subscription. Called on sign-out, revocation, and app
 * shutdown. */
export function stopLicenseWatch(): void {
	try {
		unsubscribe?.();
	} catch {
		// already gone
	}
	unsubscribe = null;
	if (client) {
		void client.close();
		client = null;
	}
	watchedUrl = null;
	watchedKey = null;
	lastSignal = null;
	haveBaseline = false;
}
