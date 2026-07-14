import { Command } from 'commander';
import { clearTasks, listTasks } from '@super-review/core';
import { resolveTarget, type TaskCommonOptions } from './shared';

async function runClear(opts: TaskCommonOptions): Promise<void> {
	const { root, branch } = await resolveTarget(opts);
	const count = (await listTasks(root, branch)).length;
	await clearTasks(root, branch);
	console.log(
		count === 0
			? `no tasks to clear on branch "${branch}"`
			: `cleared ${count} task${count === 1 ? '' : 's'} from branch "${branch}"`
	);
}

export const clear = new Command('clear')
	.description("remove the current branch's entire task list")
	.option('--branch <name>', "Operate on a specific branch's list (default: current branch).")
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runClear);
