import { Command } from 'commander';
import path from 'node:path';
import { getCurrentBranch, listLocalComments, type LocalComment } from '@super-review/core';
import { repoRoot } from '../../util';

interface ListOptions {
	unresolved?: boolean;
	json?: boolean;
	cwd?: string;
}

// One-line summary of a comment for the human-readable listing. Replies are
// indented under their root and carry no status of their own — resolution is a
// thread-level concept owned by the root.
function formatLine(c: LocalComment, isReply: boolean): string {
	const firstLine = c.body.split('\n')[0]?.trim() ?? '';
	const snippet = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
	if (isReply) return `  ↳ ${c.id}  ${snippet}`;
	const range = c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}-${c.endLine}`;
	const status = c.resolvedAt ? 'resolved' : 'open';
	return `${c.id}  [${status}]  ${c.path}:${range}  ${snippet}`;
}

// Group a flat comment list into threads: each root followed by its replies in
// chronological order. Replies point at their root via `inReplyTo`; an orphan (a
// reply whose root isn't in the list) is treated as its own root so nothing is
// silently dropped.
function toThreads(comments: LocalComment[]): { root: LocalComment; replies: LocalComment[] }[] {
	const byRoot = new Map<string, LocalComment[]>();
	const roots: LocalComment[] = [];
	for (const c of comments) {
		if (c.inReplyTo && comments.some((x) => x.id === c.inReplyTo)) {
			const list = byRoot.get(c.inReplyTo) ?? [];
			list.push(c);
			byRoot.set(c.inReplyTo, list);
		} else {
			roots.push(c);
		}
	}
	const byCreated = (a: LocalComment, b: LocalComment): number => a.createdAt - b.createdAt;
	return roots
		.sort(byCreated)
		.map((root) => ({ root, replies: (byRoot.get(root.id) ?? []).sort(byCreated) }));
}

async function runList(opts: ListOptions): Promise<void> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);

	// Comments are scoped to the branch you're on right now — no need to name it,
	// an agent is always on exactly one. (These live on the reviewer's machine, so
	// a remote/cloud agent in a fresh checkout simply finds none.)
	const branch = await getCurrentBranch(root);
	const comments = await listLocalComments(root, branch);
	const scope = branch ? `branch "${branch}"` : 'the working tree';

	// Resolution is thread-level: `--unresolved` drops a whole thread (root + its
	// replies) once the root is resolved, rather than surfacing replies — which
	// never carry their own resolution — as standalone work.
	let threads = toThreads(comments);
	if (opts.unresolved) threads = threads.filter((t) => !t.root.resolvedAt);

	if (opts.json) {
		// Flatten back to records (roots then their replies) so tooling still gets
		// every field, including `inReplyTo`.
		const flat = threads.flatMap((t) => [t.root, ...t.replies]);
		console.log(JSON.stringify(flat, null, 2));
		return;
	}

	if (threads.length === 0) {
		console.log(`no ${opts.unresolved ? 'unresolved ' : ''}comments on ${scope}`);
		return;
	}
	for (const t of threads) {
		console.log(formatLine(t.root, false));
		for (const r of t.replies) console.log(formatLine(r, true));
	}
}

export const list = new Command('list')
	.description("list the review comments on the branch you're on")
	.option('--unresolved', 'Only show comments that are not yet resolved.')
	.option('--json', 'Output the raw comment records as JSON.')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runList);
