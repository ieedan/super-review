import { Command } from 'commander';
import { list } from './list';
import { resolve, unresolve } from './resolve';

// Extra help shown under `comment --help`: where comments live and who writes them.
const COMMENT_HELP = `
Local review comments are stored in the repo under .super-review/comments/, one
JSON file per comment, so they travel with a branch/PR like sessions. Humans
leave comments in the super-review desktop app; agents read them here (use
"comment list --unresolved" to find work) and mark them resolved with
"comment resolve <id> --harness <kind> [--session <id>]".`;

export const comment = new Command('comment')
	.description('list and resolve local review comments')
	.addHelpText('after', COMMENT_HELP)
	.addCommand(list)
	.addCommand(resolve)
	.addCommand(unresolve);
