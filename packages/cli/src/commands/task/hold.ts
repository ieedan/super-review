import { Command } from 'commander';
import { updateTask } from '@super-review/core';
import { fail } from '../../util';
import { resolveTarget, type TaskCommonOptions } from './shared';

// Shared body for `hold`/`unhold`: flip a task's on-hold flag. Hold is a plain
// display state (dimmed in the app, upcoming but not ready) with no attribution,
// so it rides through the ordinary task patch.
async function run(id: string, onHold: boolean, opts: TaskCommonOptions): Promise<void> {
	const { root, branch } = await resolveTarget(opts);
	const task = await updateTask(root, branch, id, { onHold });
	if (!task) fail(`no task with id "${id}" on branch "${branch}"`);
	console.log(`${onHold ? 'put task on hold' : 'took task off hold'}: ${task.id}`);
}

export const hold = new Command('hold')
	.description('put a task on hold (upcoming, not ready to work on)')
	.argument('<id>', 'The task id (from `task list`).')
	.option('--branch <name>', "Operate on a specific branch's list (default: current branch).")
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action((id: string, opts: TaskCommonOptions) => run(id, true, opts));

export const unhold = new Command('unhold')
	.description('take a task off hold')
	.argument('<id>', 'The task id (from `task list`).')
	.option('--branch <name>', "Operate on a specific branch's list (default: current branch).")
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action((id: string, opts: TaskCommonOptions) => run(id, false, opts));
