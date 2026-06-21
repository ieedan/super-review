import { Command } from 'commander';
import { list } from './list';
import { resolve, unresolve } from './resolve';

// Extra help shown under `comment --help`: where comments live and who writes them.
const COMMENT_HELP = `
Humans leave review comments in the super-review desktop app; agents read and
resolve them through this CLI. "comment list" shows the comments on the branch
you're on; add "--pr <n>" to see a pull request's comments instead. Use
"--unresolved" to find work, then "comment resolve <id> --harness <kind>
[--session <id>]" to mark each one resolved.`;

export const comment = new Command('comment')
	.description('list and resolve local review comments')
	.addHelpText('after', COMMENT_HELP)
	.addCommand(list)
	.addCommand(resolve)
	.addCommand(unresolve);
