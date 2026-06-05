import { Command } from 'commander';
import path from 'node:path';
import { clearSessions, clearSlices, listSessions, listSlices } from '@super-review/core';
import { repoRoot } from '../../util';

// Deprecated alias for `slice clear`. Purges both the new slices and any legacy
// frozen sessions, so an existing "clear before merging" script keeps working.
async function runClear(opts: { cwd?: string }): Promise<void> {
	console.error('warning: `session clear` is deprecated. Use `slice clear` instead.');
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);
	const sliceCount = (await listSlices(root)).length;
	const sessionCount = (await listSessions(root)).length;
	await Promise.all([clearSlices(root), clearSessions(root)]);
	const total = sliceCount + sessionCount;
	console.log(
		total === 0
			? 'nothing to clear'
			: `cleared ${sliceCount} slice(s) and ${sessionCount} legacy session(s)`
	);
}

export const clear = new Command('clear')
	.description('[deprecated] alias for `slice clear` — removes all slices (and legacy sessions)')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runClear);
