import { Command } from 'commander';
import { updateTask, type TaskPatch } from '@super-review/core';
import { fail } from '../../util';
import { resolveTarget, type TaskCommonOptions } from './shared';

interface EditOptions extends TaskCommonOptions {
	title?: string;
	notes?: string;
}

async function runEdit(id: string, opts: EditOptions): Promise<void> {
	if (opts.title === undefined && opts.notes === undefined) {
		fail('nothing to edit: pass --title and/or --notes.');
	}
	const { root, branch } = await resolveTarget(opts);
	const patch: TaskPatch = {};
	if (opts.title !== undefined) patch.title = opts.title;
	if (opts.notes !== undefined) patch.notes = opts.notes;
	const task = await updateTask(root, branch, id, patch);
	if (!task) fail(`no task with id "${id}" on branch "${branch}"`);
	console.log(`updated task ${task.id}`);
}

export const edit = new Command('edit')
	.description("edit a task's title or notes")
	.argument('<id>', 'The task id (from `task list`).')
	.option('--title <text>', 'New title.')
	.option('--notes <text>', 'New notes (pass an empty string to clear).')
	.option('--branch <name>', "Operate on a specific branch's list (default: current branch).")
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runEdit);
