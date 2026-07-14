import { Command } from 'commander';
import { listTasks, listTasksAtRef, type Task, type TaskActor } from '@super-review/core';
import { resolveTarget, type TaskCommonOptions } from './shared';

interface ListOptions extends TaskCommonOptions {
	json?: boolean;
	ref?: string;
}

// "name (harness)" for an agent, just the name for a human.
function actorLabel(a: TaskActor | undefined): string {
	if (!a) return '';
	return a.harness ? `${a.name} (${a.harness})` : a.name;
}

// One-line summary of a task for the human-readable listing. Subtasks are
// indented under their parent.
function formatLine(t: Task, indent: boolean): string {
	const box = t.done ? '[x]' : '[ ]';
	const status =
		t.done && t.doneBy ? ` (done by ${actorLabel(t.doneBy)})` : t.onHold ? ' (on hold)' : '';
	return `${indent ? '    ' : ''}${box} ${t.id}  ${t.title}${status}`;
}

// Print one task followed by its notes, indented when it's a subtask.
function printTask(t: Task, indent: boolean): void {
	console.log(formatLine(t, indent));
	if (t.notes?.trim()) {
		const pad = indent ? '        ' : '      ';
		for (const line of t.notes.split('\n')) console.log(`${pad}${line}`);
	}
}

async function runList(opts: ListOptions): Promise<void> {
	const { root, branch } = await resolveTarget(opts);
	const tasks = opts.ref
		? await listTasksAtRef(root, branch, opts.ref)
		: await listTasks(root, branch);

	if (opts.json) {
		console.log(JSON.stringify(tasks, null, 2));
		return;
	}
	if (tasks.length === 0) {
		console.log(`no tasks on branch "${branch}"`);
		return;
	}
	// Top-level tasks in order, each followed by its subtasks.
	const childrenByParent = new Map<string, Task[]>();
	for (const t of tasks) {
		if (t.parentId) {
			const list = childrenByParent.get(t.parentId) ?? [];
			list.push(t);
			childrenByParent.set(t.parentId, list);
		}
	}
	for (const t of tasks) {
		if (t.parentId) continue;
		printTask(t, false);
		for (const child of childrenByParent.get(t.id) ?? []) printTask(child, true);
	}
}

export const list = new Command('list')
	.description("list the tasks on the branch you're on")
	.option('--json', 'Output the raw task records as JSON.')
	.option('--ref <ref>', 'Read the committed task list at a git ref instead of the working tree.')
	.option('--branch <name>', "Operate on a specific branch's list (default: current branch).")
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runList);
