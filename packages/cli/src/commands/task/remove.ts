import { Command } from 'commander';
import { listTasks, removeTask } from '@super-review/core';
import { fail } from '../../util';
import { resolveTarget, type TaskCommonOptions } from './shared';

async function runRemove(id: string, opts: TaskCommonOptions): Promise<void> {
	const { root, branch } = await resolveTarget(opts);
	// Distinguish "no such id" up front (removeTask is a silent no-op otherwise).
	const tasks = await listTasks(root, branch);
	if (!tasks.some((t) => t.id === id)) fail(`no task with id "${id}" on branch "${branch}"`);
	await removeTask(root, branch, id);
	console.log(`removed task ${id}`);
}

export const remove = new Command('remove')
	.description("remove a task from the current branch's list")
	.argument('<id>', 'The task id (from `task list`).')
	.option('--branch <name>', "Operate on a specific branch's list (default: current branch).")
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runRemove);
