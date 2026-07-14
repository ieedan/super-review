import { Command } from 'commander';
import { addTask, listTasks } from '@super-review/core';
import { fail } from '../../util';
import {
	HARNESSES,
	buildActor,
	resolveTarget,
	type ActorOptions,
	type TaskCommonOptions
} from './shared';

interface AddOptions extends TaskCommonOptions, ActorOptions {
	notes?: string;
	parent?: string;
}

async function runAdd(titleParts: string[], opts: AddOptions): Promise<void> {
	const title = titleParts.join(' ').trim();
	if (!title) fail('empty task: pass the task title as an argument.');

	const { root, branch } = await resolveTarget(opts);

	// A --parent must reference an existing top-level task on this branch (subtasks
	// nest one level only).
	const parentId = opts.parent?.trim() || undefined;
	if (parentId) {
		const parent = (await listTasks(root, branch)).find((t) => t.id === parentId);
		if (!parent) fail(`no task with id "${parentId}" on branch "${branch}"`);
		if (parent.parentId) fail('cannot add a subtask to a subtask (tasks nest one level only).');
	}

	const actor = buildActor(opts);
	const task = await addTask(root, branch, {
		title,
		notes: opts.notes?.trim() || undefined,
		parentId,
		actor
	});
	console.log(
		parentId
			? `added subtask ${task.id} under ${parentId}`
			: `added task ${task.id} to branch "${branch}"`
	);
}

export const add = new Command('add')
	.description("add a task to the current branch's list")
	.argument('<title...>', 'The task title.')
	.option('--notes <text>', 'Optional longer notes / description.')
	.option('--parent <id>', 'Add this as a subtask of an existing task (its id).')
	.option('--harness <kind>', `Acting agent: one of ${HARNESSES.join(', ')}.`)
	.option('--name <label>', 'Freeform actor name (overrides the harness label).')
	.option('--branch <name>', "Operate on a specific branch's list (default: current branch).")
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runAdd);
