import { Command } from 'commander';
import path from 'node:path';
import {
	getCurrentBranch,
	listCommentsForPR,
	listLocalComments,
	type LocalComment
} from '@super-review/core';
import { fail, repoRoot } from '../../util';

interface ListOptions {
	pr?: string;
	unresolved?: boolean;
	json?: boolean;
	cwd?: string;
}

// One-line summary of a comment for the human-readable listing.
function formatLine(c: LocalComment): string {
	const range = c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}-${c.endLine}`;
	const status = c.resolvedAt ? 'resolved' : 'open';
	const firstLine = c.body.split('\n')[0]?.trim() ?? '';
	const snippet = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
	return `${c.id}  [${status}]  ${c.path}:${range}  ${snippet}`;
}

async function runList(opts: ListOptions): Promise<void> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);

	// Two scopes only: a pull request (--pr), or — by default — the branch you're
	// on right now. No need to name a branch: an agent is always on exactly one.
	let comments: LocalComment[];
	let scope: string;
	if (opts.pr !== undefined) {
		const n = Number(opts.pr);
		if (!Number.isInteger(n) || n <= 0) {
			fail(`invalid --pr "${opts.pr}": expected a positive pull-request number`);
		}
		comments = await listCommentsForPR(root, n);
		scope = `PR #${n}`;
	} else {
		const branch = await getCurrentBranch(root);
		comments = await listLocalComments(root, branch);
		scope = branch ? `branch "${branch}"` : 'the working tree';
	}
	if (opts.unresolved) comments = comments.filter((c) => !c.resolvedAt);

	if (opts.json) {
		console.log(JSON.stringify(comments, null, 2));
		return;
	}

	if (comments.length === 0) {
		console.log(`no ${opts.unresolved ? 'unresolved ' : ''}comments on ${scope}`);
		return;
	}
	for (const c of comments) console.log(formatLine(c));
}

export const list = new Command('list')
	.description('list local review comments (defaults to the current branch; use --pr for a pull request)')
	.option(
		'--pr <number>',
		'List comments left while reviewing this pull request (e.g. --pr 12). Default: the branch you are on.'
	)
	.option('--unresolved', 'Only show comments that are not yet resolved.')
	.option('--json', 'Output the raw comment records as JSON.')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runList);
