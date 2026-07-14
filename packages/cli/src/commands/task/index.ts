import { Command } from 'commander';
import { list } from './list';
import { add } from './add';
import { done, undone } from './done';
import { hold, unhold } from './hold';
import { edit } from './edit';
import { remove } from './remove';
import { clear } from './clear';

// Extra help shown under `task --help`: what task lists are and where they live.
const TASK_HELP = `
A per-branch checklist for tracking work before opening a PR. Tasks are stored in
the repo under .super-review/tasks/ and committed, so a list travels with the
branch. "task add <title>" adds one, "task list" shows them, "task done <id>
--harness <kind>" checks one off (recording the acting agent), and "task edit /
remove / clear" manage them. All commands operate on the branch you're on unless
--branch names another.`;

export const task = new Command('task')
	.description("manage the branch's local task list")
	.addHelpText('after', TASK_HELP)
	.addCommand(list)
	.addCommand(add)
	.addCommand(done)
	.addCommand(undone)
	.addCommand(hold)
	.addCommand(unhold)
	.addCommand(edit)
	.addCommand(remove)
	.addCommand(clear);
