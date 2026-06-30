import { Command } from 'commander';
import path from 'node:path';
import {
	getComment,
	replyToComment,
	type HarnessKind,
	type LocalCommentAuthor
} from '@super-review/core';
import { fail, repoRoot } from '../../util';
import { replyToPullRequestReviewComment } from '../../github';
import { parsePrNumber, resolvePrContext } from '../../pr-context';
import { validateSession, withAttribution } from '../../attribution';

const HARNESSES: HarnessKind[] = ['claude-code', 'cursor', 'codex', 'opencode', 'copilot', 'other'];

interface ReplyOptions {
	message?: string;
	harness?: string;
	name?: string;
	session?: string;
	cwd?: string;
	// `--pr` mirrors `comment list`: bare (boolean `true`) detects the PR for the
	// branch, `--pr <n>` pins it, absent it's local mode.
	pr?: string | boolean;
}

// Read all of stdin as a string. Used when the reply body is piped in rather than
// passed as an argument (e.g. `… | super-review comment reply <id>`).
async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

// Validate --harness and return the typed value (or undefined).
function parseHarness(opts: ReplyOptions): HarnessKind | undefined {
	if (opts.harness && !HARNESSES.includes(opts.harness as HarnessKind)) {
		fail(`invalid --harness "${opts.harness}". Expected one of: ${HARNESSES.join(', ')}`);
	}
	return opts.harness as HarnessKind | undefined;
}

// Resolve the reply body from (in precedence order) the positional argument,
// --message, then piped stdin. Exits when empty.
async function resolveBody(body: string | undefined, opts: ReplyOptions): Promise<string> {
	const raw = body ?? opts.message ?? (process.stdin.isTTY ? '' : await readStdin());
	const text = raw.trim();
	if (!text) fail('empty reply: pass the body as an argument, --message, or on stdin.');
	return text;
}

// `--pr`: post the reply to the GitHub PR review thread instead of the local
// store. The GitHub author is the token owner (the human), so the agent identity
// (--harness/--name) and any linked --session are folded into the body as an
// attribution footer rather than stored as the author.
async function runReplyPr(
	id: string,
	body: string | undefined,
	opts: ReplyOptions,
	explicitNumber: number | null
): Promise<void> {
	const commentId = Number(id);
	if (!Number.isInteger(commentId) || commentId <= 0) {
		fail(`invalid PR comment id "${id}" (expected the numeric id from \`comment list --pr\`)`);
	}

	const harness = parseHarness(opts);
	const text = await resolveBody(body, opts);

	const { root, owner, repo, token, prNumber } = await resolvePrContext(
		opts.cwd ?? process.cwd(),
		explicitNumber
	);
	await validateSession(root, opts.session);

	const withFooter = withAttribution(text, 'Reply from', {
		harness,
		name: opts.name,
		session: opts.session
	});

	let created: { id: number; html_url: string };
	try {
		created = await replyToPullRequestReviewComment(
			owner,
			repo,
			prNumber,
			commentId,
			withFooter,
			token
		);
	} catch (err) {
		fail(err instanceof Error ? err.message : String(err));
	}
	console.log(`replied to PR comment ${commentId} (new ${created.id})`);
	console.log(created.html_url);
}

async function runReply(id: string, body: string | undefined, opts: ReplyOptions): Promise<void> {
	if (opts.pr !== undefined) return runReplyPr(id, body, opts, parsePrNumber(opts.pr));

	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);

	const harness = parseHarness(opts);
	const text = await resolveBody(body, opts);

	// CLI replies are agent-authored; identify via --harness (its logo shows in the
	// app) with an optional friendlier --name, mirroring `comment resolve`.
	const author: LocalCommentAuthor = {
		kind: 'agent',
		name: opts.name ?? harness ?? 'agent',
		...(harness ? { harness } : {})
	};

	// Surface a clear error before writing if the target is gone (replyToComment
	// also returns null, but this distinguishes "no such id" up front).
	const target = await getComment(root, id);
	if (!target) fail(`no comment with id "${id}" in this repo`);

	const created = await replyToComment(root, id, text, author);
	if (!created) fail(`no comment with id "${id}" in this repo`);
	const rootId = created.inReplyTo ?? created.id;
	console.log(`replied to comment ${rootId} (new ${created.id})`);
}

export const reply = new Command('reply')
	.description('reply to a review comment thread (local, or a GitHub PR with --pr)')
	.argument('<id>', 'The comment id to reply to (from `comment list`).')
	.argument('[body]', 'The reply body (Markdown). Omit to use --message or stdin.')
	.option('-m, --message <text>', 'The reply body, as an alternative to the positional argument.')
	.option('--harness <kind>', `Replying agent: one of ${HARNESSES.join(', ')}.`)
	.option('--name <label>', 'Freeform author name (overrides the harness label).')
	.option(
		'--session <id>',
		'Link the session that documents the reply; shown in the PR attribution footer.'
	)
	.option(
		'--pr [number]',
		"Reply on a GitHub pull request instead of the local store. With no number, detects the open PR for the current branch. Uses the Super Review app's sign-in, or GH_TOKEN/GITHUB_TOKEN."
	)
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runReply);
