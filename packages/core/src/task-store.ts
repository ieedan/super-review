import { promises as fs, existsSync, watch, type FSWatcher } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import type { Task, TaskList, NewTaskInput, TaskPatch, TaskActor } from './types.js';

const execFileAsync = promisify(execFile);

// Task lists are tiny, but keep a generous cap so a `git show` never truncates
// into a parse error (matches the sessions reader).
const MAX_TASKS_BYTES = 16 * 1024 * 1024;

// Git always addresses paths with forward slashes, so the in-tree tasks location
// is hardcoded posix rather than derived from `tasksDir` (which uses the OS
// separator). Used by the read-from-ref helpers below.
const TASKS_TREE_PATH = '.super-review/tasks';

// Tasks live inside the repo so they can be committed to a branch and travel
// with it — the list is scoped per branch. One JSON file per branch:
//
//   <repoPath>/.super-review/tasks/<branchSlug>.json
//
// Functions are keyed by the repo's filesystem path and the branch name (the CLI
// resolves the branch from HEAD; the Electron app passes the viewed branch).
function tasksDir(repoPath: string): string {
	return path.join(repoPath, '.super-review', 'tasks');
}

// A filesystem-safe, deterministic filename for a branch. Slash and other unsafe
// characters collapse to '-', and a short hash of the *full* branch name is
// appended so distinct branches that slugify the same (e.g. `feat/x` vs `feat-x`)
// never collide onto one file. The real branch name is also stored inside the
// file for verification.
export function taskFileSlug(branch: string): string {
	const safe = branch.replace(/[^a-zA-Z0-9._-]/g, '-');
	const hash = createHash('sha1').update(branch).digest('hex').slice(0, 8);
	return `${safe}-${hash}`;
}

function tasksPath(repoPath: string, branch: string): string {
	return path.join(tasksDir(repoPath), `${taskFileSlug(branch)}.json`);
}

function byOrder(a: Task, b: Task): number {
	return a.order - b.order;
}

async function readTaskList(file: string): Promise<TaskList | null> {
	try {
		const raw = await fs.readFile(file, 'utf8');
		return JSON.parse(raw) as TaskList;
	} catch {
		// Missing or malformed file — treat as "no list" rather than failing.
		return null;
	}
}

async function writeTaskList(repoPath: string, list: TaskList): Promise<void> {
	const dir = tasksDir(repoPath);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(tasksPath(repoPath, list.branch), JSON.stringify(list, null, 2), 'utf8');
}

// The full task list for a branch, or null when the branch has no file yet.
export async function getTaskList(repoPath: string, branch: string): Promise<TaskList | null> {
	return readTaskList(tasksPath(repoPath, branch));
}

// A branch's tasks, ordered. Empty array when the branch has no list yet.
export async function listTasks(repoPath: string, branch: string): Promise<Task[]> {
	const list = await getTaskList(repoPath, branch);
	return (list?.tasks ?? []).slice().sort(byOrder);
}

// Load-or-init a branch's list so writers share one shape.
async function loadList(repoPath: string, branch: string, now: number): Promise<TaskList> {
	return (await getTaskList(repoPath, branch)) ?? { branch, tasks: [], updatedAt: now };
}

// Append a task to the branch's list. Assigns id/order/timestamps and records
// the creator.
export async function addTask(
	repoPath: string,
	branch: string,
	input: NewTaskInput,
	now: number = Date.now()
): Promise<Task> {
	const list = await loadList(repoPath, branch, now);
	// Order among siblings (tasks sharing this parent) so a subtask appends under
	// its parent rather than at the very end of the flat list.
	const siblings = list.tasks.filter((t) => (t.parentId ?? null) === (input.parentId ?? null));
	const maxOrder = siblings.reduce((m, t) => Math.max(m, t.order), -1);
	const task: Task = {
		id: randomUUID(),
		title: input.title,
		notes: input.notes,
		...(input.parentId ? { parentId: input.parentId } : {}),
		done: false,
		order: maxOrder + 1,
		createdAt: now,
		updatedAt: now,
		createdBy: input.actor
	};
	list.tasks.push(task);
	list.updatedAt = now;
	await writeTaskList(repoPath, list);
	return task;
}

// Edit a task's title/notes/order. Returns the updated task, or null when the id
// isn't found. Attribution is untouched (done-state changes go through
// `setTaskDone`).
export async function updateTask(
	repoPath: string,
	branch: string,
	id: string,
	patch: TaskPatch,
	now: number = Date.now()
): Promise<Task | null> {
	const list = await getTaskList(repoPath, branch);
	const task = list?.tasks.find((t) => t.id === id);
	if (!list || !task) return null;
	if (patch.title !== undefined) task.title = patch.title;
	if (patch.notes !== undefined) task.notes = patch.notes;
	if (patch.order !== undefined) task.order = patch.order;
	if (patch.onHold !== undefined) {
		if (patch.onHold) task.onHold = true;
		else delete task.onHold;
	}
	task.updatedAt = now;
	list.updatedAt = now;
	await writeTaskList(repoPath, list);
	return task;
}

// Check a task off (or uncheck it), recording who did it. On check, sets
// `doneBy`/`doneAt`; on uncheck, clears them. Returns the updated task, or null
// when the id isn't found.
export async function setTaskDone(
	repoPath: string,
	branch: string,
	id: string,
	done: boolean,
	actor: TaskActor,
	now: number = Date.now()
): Promise<Task | null> {
	const list = await getTaskList(repoPath, branch);
	const task = list?.tasks.find((t) => t.id === id);
	if (!list || !task) return null;
	task.done = done;
	if (done) {
		task.doneBy = actor;
		task.doneAt = now;
	} else {
		delete task.doneBy;
		delete task.doneAt;
	}
	task.updatedAt = now;
	list.updatedAt = now;
	await writeTaskList(repoPath, list);
	return task;
}

// Remove a task from the branch's list, along with its entire subtree of
// subtasks (tasks nest arbitrarily deep, so a deleted parent's descendants would
// otherwise be orphaned). No-op when the id isn't present.
export async function removeTask(
	repoPath: string,
	branch: string,
	id: string,
	now: number = Date.now()
): Promise<void> {
	const list = await getTaskList(repoPath, branch);
	if (!list) return;
	// Collect the task and every descendant. Loop until no new descendant is
	// found so nesting of any depth is fully cleaned up.
	const doomed = new Set([id]);
	for (let added = true; added; ) {
		added = false;
		for (const t of list.tasks) {
			if (t.parentId && doomed.has(t.parentId) && !doomed.has(t.id)) {
				doomed.add(t.id);
				added = true;
			}
		}
	}
	const next = list.tasks.filter((t) => !doomed.has(t.id));
	if (next.length === list.tasks.length) return;
	list.tasks = next;
	list.updatedAt = now;
	await writeTaskList(repoPath, list);
}

// Reorder the branch's tasks to match `ids` (unlisted ids keep their relative
// order after the listed ones). Rewrites each task's `order`.
export async function reorderTasks(
	repoPath: string,
	branch: string,
	ids: string[],
	now: number = Date.now()
): Promise<void> {
	const list = await getTaskList(repoPath, branch);
	if (!list) return;
	const rank = new Map(ids.map((id, i) => [id, i]));
	const ordered = list.tasks
		.slice()
		.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
	ordered.forEach((t, i) => (t.order = i));
	list.updatedAt = now;
	await writeTaskList(repoPath, list);
}

// Remove a branch's entire task list (deletes its file).
export async function clearTasks(repoPath: string, branch: string): Promise<void> {
	await fs.rm(tasksPath(repoPath, branch), { force: true });
}

// ─── Reading tasks from a git ref ────────────────────────────────────────────
// Tasks are committed into the branch, so reviewing a branch/PR read-only —
// without checking it out — means reading that ref's committed file straight from
// git's object store (`git show <ref>:<path>`), mirroring `listSessionsAtRef`.
export async function listTasksAtRef(
	repoPath: string,
	branch: string,
	ref: string
): Promise<Task[]> {
	try {
		const { stdout } = await execFileAsync(
			'git',
			['show', `${ref}:${TASKS_TREE_PATH}/${taskFileSlug(branch)}.json`],
			{ cwd: repoPath, maxBuffer: MAX_TASKS_BYTES }
		);
		const list = JSON.parse(stdout) as TaskList;
		return (list.tasks ?? []).slice().sort(byOrder);
	} catch {
		// Missing ref/path or malformed JSON — just "no tasks".
		return [];
	}
}

// Watch the repo's tasks for changes and call `onChange` (debounced) whenever a
// list is written or removed — so a CLI edit (or another window) shows up in the
// app immediately. Mirrors `watchSessionsDir`: watch `.super-review` recursively
// once it exists, otherwise the nearest existing ancestor, switching over the
// moment it appears. Returns a teardown function.
export function watchTasksDir(repoPath: string, onChange: () => void): () => void {
	const superDir = path.join(repoPath, '.super-review');
	const tasksName = path.basename(tasksDir(repoPath));
	let watcher: FSWatcher | null = null;
	let debounce: ReturnType<typeof setTimeout> | null = null;
	let rearmTimer: ReturnType<typeof setTimeout> | null = null;
	let closed = false;

	const notify = (): void => {
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(onChange, 150);
	};

	const deepestExisting = (): string => {
		let dir = superDir;
		while (!existsSync(dir)) dir = path.dirname(dir);
		return dir;
	};

	const arm = (): void => {
		if (closed) return;
		const dir = deepestExisting();
		const watchingSuper = dir === superDir;
		try {
			watcher = watch(dir, watchingSuper ? { recursive: true } : undefined, (_event, file) => {
				if (watchingSuper) {
					// `file` is relative to `.super-review` (e.g. "tasks" or
					// "tasks/<slug>.json"); react only to the tasks subdir.
					if (!file || file === tasksName || file.startsWith(tasksName + path.sep)) {
						notify();
					}
				} else if (existsSync(superDir)) {
					rearm();
				}
			});
			watcher.on('error', scheduleRearm);
		} catch {
			scheduleRearm();
		}
	};

	function rearm(): void {
		if (closed) return;
		try {
			watcher?.close();
		} catch {
			/* already gone */
		}
		watcher = null;
		arm();
		notify();
	}

	function scheduleRearm(): void {
		if (closed || rearmTimer) return;
		rearmTimer = setTimeout(() => {
			rearmTimer = null;
			rearm();
		}, 200);
	}

	arm();

	return () => {
		closed = true;
		if (debounce) clearTimeout(debounce);
		if (rearmTimer) clearTimeout(rearmTimer);
		try {
			watcher?.close();
		} catch {
			/* already gone */
		}
		watcher = null;
	};
}
