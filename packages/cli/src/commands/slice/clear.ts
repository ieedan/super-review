import { Command } from 'commander';
import path from 'node:path';
import { clearSlices, listSlices } from '@super-review/core';
import { repoRoot } from '../../util';

async function runClear(opts: { cwd?: string }): Promise<void> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);
	const count = (await listSlices(root)).length;
	await clearSlices(root);
	console.log(
		count === 0
			? 'no slices to clear'
			: `cleared ${count} slice${count === 1 ? '' : 's'} from .super-review/slices/`
	);
}

export const clear = new Command('clear')
	.description('remove all slices from the repo (.super-review/slices/)')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runClear);
