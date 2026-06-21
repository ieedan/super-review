import { Command } from 'commander';
import path from 'node:path';
import { getCurrentBranch, listLocalComments, type LocalComment } from '@super-review/core';
import { repoRoot } from '../../util';

interface ListOptions {
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

	// Comments are scoped to the branch you're on right now — no need to name it,
	// an agent is always on exactly one. (These live on the reviewer's machine, so
	// a remote/cloud agent in a fresh checkout simply finds none.)
	const branch = await getCurrentBranch(root);
	let comments = await listLocalComments(root, branch);
	const scope = branch ? `branch "${branch}"` : 'the working tree';
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
	.description("list the review comments on the branch you're on")
	.option('--unresolved', 'Only show comments that are not yet resolved.')
	.option('--json', 'Output the raw comment records as JSON.')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runList);
