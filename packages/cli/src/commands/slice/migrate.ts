import { Command } from 'commander';
import path from 'node:path';
import { migrateSessionsToSlices } from '@super-review/core';
import { repoRoot } from '../../util';

async function runMigrate(opts: { cwd?: string }): Promise<void> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);
	const { migrated, skipped, movedTo } = await migrateSessionsToSlices(root);
	if (migrated === 0 && skipped === 0) {
		console.log('no legacy sessions to migrate');
		return;
	}
	console.log(
		`migrated ${migrated} session(s) to slices` +
			(skipped > 0 ? `, skipped ${skipped} (already migrated or unreadable)` : '')
	);
	if (movedTo) {
		console.log(`originals moved aside to ${path.relative(root, movedTo)} (not deleted)`);
	}
}

export const migrate = new Command('migrate')
	.description('convert legacy .super-review/sessions/*.json into content-free slices')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runMigrate);
