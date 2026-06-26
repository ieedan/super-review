import { Command } from 'commander';
import path from 'node:path';
import {
	getCurrentBranch,
	listLocalComments,
	resolveGithubRepo,
	type LocalComment
} from '@super-review/core';
import { fail, repoRoot } from '../../util';
import {
	findOpenPrForBranch,
	listPullRequestReviewComments,
	resolveGithubToken,
	type GithubReviewComment
} from '../../github';

interface ListOptions {
	unresolved?: boolean;
	json?: boolean;
	cwd?: string;
	// `--pr` with no value is `true` (detect the open PR for the branch); with a
	// value it's the PR number as a string; absent it's undefined (local mode).
	pr?: string | boolean;
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

// One-line summary of a GitHub inline review comment, mirroring the local
// `formatLine` shape. GitHub review comments have no thread-level "resolved"
// state in the REST API (that's a GraphQL concept), so we tag them `[review]`
// rather than open/resolved. Replies point at their root via `in_reply_to_id`.
function formatGithubLine(c: GithubReviewComment, isReply: boolean): string {
	const firstLine = c.body.split('\n')[0]?.trim() ?? '';
	const snippet = firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
	const author = c.user?.login ?? 'unknown';
	if (isReply) return `  ↳ ${c.id}  @${author}  ${snippet}`;
	const lineNo = c.line ?? c.original_line;
	const range =
		c.start_line && lineNo && c.start_line !== lineNo
			? `L${c.start_line}-${lineNo}`
			: `L${lineNo ?? '?'}`;
	return `${c.id}  [review]  @${author}  ${c.path}:${range}  ${snippet}`;
}

// `--pr <number>`: list the inline review comments on the GitHub pull request
// instead of the local, branch-scoped ones. Reuses the desktop app's signed-in
// token (falling back to GH_TOKEN/GITHUB_TOKEN); never touches the local store.
async function runListPr(opts: ListOptions, explicitNumber: number | null): Promise<void> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);

	const slug = await resolveGithubRepo(root);
	if (!slug) fail("couldn't determine the GitHub owner/repo from the 'origin' remote");

	const token = resolveGithubToken();
	if (!token) {
		fail(
			'no GitHub token available. Sign in with the Super Review app, or set GH_TOKEN/GITHUB_TOKEN.'
		);
	}

	// With a bare `--pr`, find the open PR whose head is the current branch. We
	// announce the choice on stderr so stdout (especially `--json`) stays clean.
	let prNumber = explicitNumber;
	if (prNumber === null) {
		const branch = await getCurrentBranch(root);
		if (!branch) fail('not on a branch, so there is no PR to detect. Pass --pr <number>.');
		let pr;
		try {
			pr = await findOpenPrForBranch(slug.owner, slug.repo, branch, token);
		} catch (err) {
			fail(err instanceof Error ? err.message : String(err));
		}
		if (!pr) {
			fail(
				`no open pull request found for branch "${branch}" on ${slug.owner}/${slug.repo}. Pass --pr <number>.`
			);
		}
		prNumber = pr.number;
		console.error(`using PR #${pr.number}: ${pr.title}`);
	}

	let comments: GithubReviewComment[];
	try {
		comments = await listPullRequestReviewComments(slug.owner, slug.repo, prNumber, token);
	} catch (err) {
		fail(err instanceof Error ? err.message : String(err));
	}

	// Thread by `in_reply_to_id`: each root followed by its replies, oldest first.
	// An orphan reply (root not in the list) is treated as its own root.
	const byId = new Set(comments.map((c) => c.id));
	const repliesByRoot = new Map<number, GithubReviewComment[]>();
	const roots: GithubReviewComment[] = [];
	for (const c of comments) {
		if (c.in_reply_to_id && byId.has(c.in_reply_to_id)) {
			const list = repliesByRoot.get(c.in_reply_to_id) ?? [];
			list.push(c);
			repliesByRoot.set(c.in_reply_to_id, list);
		} else {
			roots.push(c);
		}
	}

	if (opts.json) {
		console.log(JSON.stringify(comments, null, 2));
		return;
	}
	if (comments.length === 0) {
		console.log(`no review comments on ${slug.owner}/${slug.repo} #${prNumber}`);
		return;
	}
	for (const r of roots) {
		console.log(formatGithubLine(r, false));
		for (const reply of repliesByRoot.get(r.id) ?? []) console.log(formatGithubLine(reply, true));
	}
}

async function runList(opts: ListOptions): Promise<void> {
	if (opts.pr !== undefined) {
		// `--pr` alone (boolean `true`) means "detect the PR for this branch";
		// `--pr <n>` pins an explicit number.
		let explicit: number | null = null;
		if (typeof opts.pr === 'string') {
			const n = Number(opts.pr);
			if (!Number.isInteger(n) || n <= 0) {
				fail(`invalid --pr value: ${opts.pr} (expected a positive integer)`);
			}
			explicit = n;
		}
		return runListPr(opts, explicit);
	}

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
	.option(
		'--pr [number]',
		"List the inline review comments on a GitHub pull request instead of the local ones. With no number, detects the open PR for the current branch. Uses the Super Review app's sign-in, or GH_TOKEN/GITHUB_TOKEN."
	)
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runList);
