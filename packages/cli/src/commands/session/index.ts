import { Command } from 'commander';
import { save } from './save';
import { clear } from './clear';

// Extra help shown under `session --help`: where sessions live and why.
const SESSION_HELP = `
Sessions are stored in the repo under .super-review/sessions/, so they can be
committed and travel with a branch/PR. Run "session clear" to remove them all
(e.g. before merging) — git then sees the committed manifests as deleted.`;

export const session = new Command('session')
	.description('create and manage review sessions')
	.addHelpText('after', SESSION_HELP)
	.addCommand(save)
	.addCommand(clear);
