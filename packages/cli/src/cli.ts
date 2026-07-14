import { program } from 'commander';
import pkg from '../package.json';
import * as commands from './commands';

// Construct the root program by importing the command instances and adding
// them. Kept separate from the bin entry so the program can be built (and its
// help inspected) without parsing process.argv.
const cli = program
	.name('super-review')
	.description(pkg.description)
	.version(pkg.version)
	.showHelpAfterError()
	.addCommand(commands.session)
	.addCommand(commands.comment)
	.addCommand(commands.task);

export { cli };
