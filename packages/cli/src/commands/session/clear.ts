import { Command } from 'commander';
import path from 'node:path';
import { clearSessions, listSessions } from '@super-review/core';
import { repoRoot } from '../../util';

async function runClear(opts: { cwd?: string }): Promise<void> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);
	const count = (await listSessions(root)).length;
	await clearSessions(root);
	console.log(
		count === 0
			? 'no sessions to clear'
			: `cleared ${count} session${count === 1 ? '' : 's'} from .super-review/sessions/`
	);
}

export const clear = new Command('clear')
	.description('remove all sessions from the repo (.super-review/sessions/)')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runClear);
