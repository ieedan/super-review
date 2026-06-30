import { Command } from 'commander';
import path from 'node:path';
import {
	getSession,
	resolveComment,
	unresolveComment,
	type HarnessKind,
	type LocalCommentAuthor
} from '@super-review/core';
import { fail, repoRoot } from '../../util';
import {
	findThreadIdForComment,
	replyToPullRequestReviewComment,
	setReviewThreadResolved
} from '../../github';
import { parsePrNumber, resolvePrContext } from '../../pr-context';
import { validateSession, withAttribution } from '../../attribution';

const HARNESSES: HarnessKind[] = ['claude-code', 'cursor', 'codex', 'opencode', 'copilot', 'other'];

interface ResolveOptions {
	harness?: string;
	name?: string;
	session?: string;
	message?: string;
	cwd?: string;
	// `--pr` mirrors `comment list`: bare (boolean `true`) detects the PR for the
	// branch, `--pr <n>` pins it, absent it's local mode.
	pr?: string | boolean;
}

// Validate --harness and return the typed value (or undefined).
function parseHarness(opts: ResolveOptions): HarnessKind | undefined {
	if (opts.harness && !HARNESSES.includes(opts.harness as HarnessKind)) {
		fail(`invalid --harness "${opts.harness}". Expected one of: ${HARNESSES.join(', ')}`);
	}
	return opts.harness as HarnessKind | undefined;
}

// `--pr`: flip the GitHub PR review thread's resolved state. GitHub's resolve
// mutation posts no comment of its own, so we first post a short note (carrying
// the agent identity + linked session as an attribution footer) to the thread,
// then resolve/unresolve it. The note keeps a visible trace on the PR, mirroring
// the local resolve's recorded resolver + session.
async function runResolvePr(
	id: string,
	opts: ResolveOptions,
	explicitNumber: number | null,
	resolved: boolean
): Promise<void> {
	const commentId = Number(id);
	if (!Number.isInteger(commentId) || commentId <= 0) {
		fail(`invalid PR comment id "${id}" (expected the numeric id from \`comment list --pr\`)`);
	}

	const harness = parseHarness(opts);

	const { root, owner, repo, token, prNumber } = await resolvePrContext(
		opts.cwd ?? process.cwd(),
		explicitNumber
	);
	await validateSession(root, opts.session);

	let threadId: string | null;
	try {
		threadId = await findThreadIdForComment(owner, repo, prNumber, commentId, token);
	} catch (err) {
		fail(err instanceof Error ? err.message : String(err));
	}
	if (!threadId) {
		fail(`comment #${commentId} isn't part of a review thread on ${owner}/${repo} #${prNumber}`);
	}

	// Default note body matches the action; --message lets the agent say why.
	const verb = resolved ? 'Resolved' : 'Reopened';
	const body = opts.message?.trim() || verb;
	const note = withAttribution(body, `${verb} by`, {
		harness,
		name: opts.name,
		session: opts.session
	});

	try {
		await replyToPullRequestReviewComment(owner, repo, prNumber, commentId, note, token);
		const isResolved = await setReviewThreadResolved(threadId, resolved, token);
		const state = isResolved ? 'resolved' : 'unresolved';
		console.log(`${state} PR thread for comment ${commentId}`);
	} catch (err) {
		fail(err instanceof Error ? err.message : String(err));
	}
}

async function runResolve(id: string, opts: ResolveOptions): Promise<void> {
	if (opts.pr !== undefined) return runResolvePr(id, opts, parsePrNumber(opts.pr), true);

	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);

	const harness = parseHarness(opts);

	// CLI resolutions are agent-driven; identify via --harness (its logo shows in
	// the app) with an optional friendlier --name.
	const resolver: LocalCommentAuthor = {
		kind: 'agent',
		name: opts.name ?? harness ?? 'agent',
		...(harness ? { harness } : {})
	};

	// Validate a linked session exists so a typo doesn't leave a dead link in the
	// app (the reviewer would click through to nothing).
	if (opts.session) {
		const session = await getSession(root, opts.session);
		if (!session) fail(`no session with id "${opts.session}" in this repo`);
	}

	const updated = await resolveComment(root, id, resolver, opts.session ?? null);
	if (!updated) fail(`no comment with id "${id}" in this repo`);
	const link = updated.resolvedSessionId ? ` (linked session ${updated.resolvedSessionId})` : '';
	console.log(`resolved comment ${updated.id}${link}`);
}

async function runUnresolve(id: string, opts: ResolveOptions): Promise<void> {
	if (opts.pr !== undefined) return runResolvePr(id, opts, parsePrNumber(opts.pr), false);

	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);
	const updated = await unresolveComment(root, id);
	if (!updated) fail(`no comment with id "${id}" in this repo`);
	console.log(`unresolved comment ${updated.id}`);
}

export const resolve = new Command('resolve')
	.description('mark a review comment as resolved (local, or a GitHub PR thread with --pr)')
	.argument('<id>', 'The comment id (from `comment list`).')
	.option('--harness <kind>', `Resolving agent: one of ${HARNESSES.join(', ')}.`)
	.option('--name <label>', 'Freeform resolver name (overrides the harness label).')
	.option(
		'--session <id>',
		'Link the session that documents the fix, so the reviewer can jump to it.'
	)
	.option(
		'-m, --message <text>',
		'Note posted to the PR thread before resolving (default: "Resolved"). Only used with --pr.'
	)
	.option(
		'--pr [number]',
		'Resolve a GitHub pull request review thread instead of a local comment. Posts a short note, then resolves. With no number, detects the open PR for the current branch.'
	)
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runResolve);

export const unresolve = new Command('unresolve')
	.description('clear a review comment’s resolved state (local, or a GitHub PR thread with --pr)')
	.argument('<id>', 'The comment id (from `comment list`).')
	.option('--harness <kind>', `Reopening agent: one of ${HARNESSES.join(', ')}.`)
	.option('--name <label>', 'Freeform name (overrides the harness label).')
	.option('--session <id>', 'Link a session; shown in the PR attribution footer.')
	.option(
		'-m, --message <text>',
		'Note posted to the PR thread before reopening (default: "Reopened"). Only used with --pr.'
	)
	.option(
		'--pr [number]',
		'Unresolve a GitHub pull request review thread instead of a local comment. Posts a short note, then unresolves.'
	)
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runUnresolve);
