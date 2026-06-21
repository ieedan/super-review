import { Command } from 'commander';
import { list } from './list';
import { resolve, unresolve } from './resolve';

// Extra help shown under `comment --help`: where comments live and who writes them.
const COMMENT_HELP = `
Local review comments live in a per-machine SQLite database
(~/.super-review/comments.db) shared by the super-review desktop app and this
CLI — a personal review aid, not committed to the repo. Humans leave comments in
the desktop app; agents read them here (use "comment list --unresolved" to find
work, and "--context pr:<n>" to see a pull request's comments) and mark them
resolved with "comment resolve <id> --harness <kind> [--session <id>]".`;

export const comment = new Command('comment')
	.description('list and resolve local review comments')
	.addHelpText('after', COMMENT_HELP)
	.addCommand(list)
	.addCommand(resolve)
	.addCommand(unresolve);
