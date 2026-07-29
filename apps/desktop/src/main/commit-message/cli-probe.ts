// Streaming flags differ across CLI releases, and passing one that doesn't exist
// fails the whole run. Probe `--help` once per binary and cache the answer.

import { spawnCapture } from './spawn.js';

const cache = new Map<string, boolean>();

export async function cliSupportsFlag(
	binary: string,
	helpArgs: string[],
	flag: string,
	cwd: string
): Promise<boolean> {
	const key = `${binary} ${helpArgs.join(' ')} ${flag}`;
	const cached = cache.get(key);
	if (cached != null) return cached;

	// No initializer: both branches below assign it, and a starting value that is
	// never read is what `no-useless-assignment` exists to catch.
	let supported: boolean;
	try {
		const help = await spawnCapture(binary, helpArgs, { cwd, timeoutMs: 10_000 });
		const text = `${help.stdout}\n${help.stderr}`;
		// Anchored so look-alikes (--json vs --json-schema) don't count.
		const pattern = new RegExp(`(^|[\\s,])${escapeRegExp(flag)}(?![\\w-])`);
		supported = pattern.test(text);
	} catch {
		supported = false;
	}
	cache.set(key, supported);
	return supported;
}

export function clearCliProbeCache(): void {
	cache.clear();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
