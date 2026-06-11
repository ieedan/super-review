import { Command } from 'commander';
import path from 'node:path';
import { listComments, listCommentsForContext, type LocalComment } from '@super-review/core';
import { repoRoot } from '../../util';

interface ListOptions {
	context?: string;
	all?: boolean;
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

	// Default to the working-tree context; --all spans every context.
	const contextKey = opts.context ?? 'workingTree';
	let comments = opts.all
		? await listComments(root)
		: await listCommentsForContext(root, contextKey);
	if (opts.unresolved) comments = comments.filter((c) => !c.resolvedAt);

	if (opts.json) {
		console.log(JSON.stringify(comments, null, 2));
		return;
	}

	if (comments.length === 0) {
		console.log(
			opts.all
				? 'no comments in this repo'
				: `no comments in context "${contextKey}"` + (opts.unresolved ? ' (unresolved)' : '')
		);
		return;
	}
	for (const c of comments) console.log(formatLine(c));
}

export const list = new Command('list')
	.description('list local review comments (defaults to the working-tree context)')
	.option(
		'--context <key>',
		'Diff-context key to list (e.g. "workingTree", "branch:main..feat", "pr:12"). Default: workingTree.'
	)
	.option('--all', 'List comments across every context, ignoring --context.')
	.option('--unresolved', 'Only show comments that are not yet resolved.')
	.option('--json', 'Output the raw comment records as JSON.')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runList);
