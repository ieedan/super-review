import { Command } from 'commander';
import { setTaskDone } from '@super-review/core';
import { fail } from '../../util';
import {
	HARNESSES,
	buildActor,
	resolveTarget,
	type ActorOptions,
	type TaskCommonOptions
} from './shared';

interface DoneOptions extends TaskCommonOptions, ActorOptions {}

// Shared body for `done`/`undone`: flip a task's checked state and record who did
// it (agents identify via --harness). `done === true` sets doneBy/doneAt; false
// clears them.
async function run(id: string, done: boolean, opts: DoneOptions): Promise<void> {
	const { root, branch } = await resolveTarget(opts);
	const actor = buildActor(opts);
	const task = await setTaskDone(root, branch, id, done, actor);
	if (!task) fail(`no task with id "${id}" on branch "${branch}"`);
	console.log(`${done ? 'checked off' : 'reopened'} task ${task.id}`);
}

export const done = new Command('done')
	.description("check a task off the current branch's list")
	.argument('<id>', 'The task id (from `task list`).')
	.option('--harness <kind>', `Acting agent: one of ${HARNESSES.join(', ')}.`)
	.option('--name <label>', 'Freeform actor name (overrides the harness label).')
	.option('--branch <name>', "Operate on a specific branch's list (default: current branch).")
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action((id: string, opts: DoneOptions) => run(id, true, opts));

export const undone = new Command('undone')
	.description('reopen a checked-off task')
	.argument('<id>', 'The task id (from `task list`).')
	.option('--harness <kind>', `Acting agent: one of ${HARNESSES.join(', ')}.`)
	.option('--name <label>', 'Freeform actor name (overrides the harness label).')
	.option('--branch <name>', "Operate on a specific branch's list (default: current branch).")
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action((id: string, opts: DoneOptions) => run(id, false, opts));
