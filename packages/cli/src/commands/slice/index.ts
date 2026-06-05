import { Command } from 'commander';
import { save } from './save';
import { clear } from './clear';

const SLICE_HELP = `
Slices are stored in the repo under .super-review/slices/, so they can be
committed and travel with a branch/PR. They store no code — only paths,
narrative, and drift-following anchors — so a reviewer always sees the live
diff. Run "slice clear" to remove them all (e.g. before merging).`;

export const slice = new Command('slice')
	.description('create and manage review slices')
	.addHelpText('after', SLICE_HELP)
	.addCommand(save)
	.addCommand(clear);
