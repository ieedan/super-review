import { Command } from 'commander';
import { list } from './list';
import { resolve, unresolve } from './resolve';

// Extra help shown under `comment --help`: where comments live and who writes them.
const COMMENT_HELP = `
Humans leave review comments in the super-review desktop app; agents read and
resolve them through this CLI. "comment list" shows the comments on the branch
you're on (use "--unresolved" to find work), then "comment resolve <id> --harness
<kind> [--session <id>]" marks each one resolved. These comments live on the
reviewer's machine, so an agent running remotely (a fresh checkout) finds none.`;

export const comment = new Command('comment')
	.description('list and resolve local review comments')
	.addHelpText('after', COMMENT_HELP)
	.addCommand(list)
	.addCommand(resolve)
	.addCommand(unresolve);
