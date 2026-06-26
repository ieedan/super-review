import { Command } from 'commander';
import { list } from './list';
import { reply } from './reply';
import { resolve, unresolve } from './resolve';

// Extra help shown under `comment --help`: where comments live and who writes them.
const COMMENT_HELP = `
Humans leave review comments in the super-review desktop app; agents read, reply
to, and resolve them through this CLI. "comment list" shows the comments on the
branch you're on (use "--unresolved" to find work), "comment reply <id> --harness
<kind> <body>" posts a reply to a thread, and "comment resolve <id> --harness
<kind> [--session <id>]" marks one resolved. These comments live on the reviewer's
machine, so an agent running remotely (a fresh checkout) finds none.`;

export const comment = new Command('comment')
	.description('list, reply to, and resolve local review comments')
	.addHelpText('after', COMMENT_HELP)
	.addCommand(list)
	.addCommand(reply)
	.addCommand(resolve)
	.addCommand(unresolve);
