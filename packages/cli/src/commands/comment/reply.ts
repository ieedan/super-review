import { Command } from 'commander';
import path from 'node:path';
import {
	getComment,
	replyToComment,
	type HarnessKind,
	type LocalCommentAuthor
} from '@super-review/core';
import { fail, repoRoot } from '../../util';

const HARNESSES: HarnessKind[] = ['claude-code', 'cursor', 'codex', 'opencode', 'copilot', 'other'];

interface ReplyOptions {
	message?: string;
	harness?: string;
	name?: string;
	cwd?: string;
}

// Read all of stdin as a string. Used when the reply body is piped in rather than
// passed as an argument (e.g. `… | super-review comment reply <id>`).
async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

async function runReply(id: string, body: string | undefined, opts: ReplyOptions): Promise<void> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);

	if (opts.harness && !HARNESSES.includes(opts.harness as HarnessKind)) {
		fail(`invalid --harness "${opts.harness}". Expected one of: ${HARNESSES.join(', ')}`);
	}
	const harness = opts.harness as HarnessKind | undefined;

	// Body precedence: positional argument, then --message, then piped stdin.
	const raw = body ?? opts.message ?? (process.stdin.isTTY ? '' : await readStdin());
	const text = raw.trim();
	if (!text) fail('empty reply: pass the body as an argument, --message, or on stdin.');

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
	.description('reply to a local review comment thread')
	.argument('<id>', 'The comment id to reply to (from `comment list`).')
	.argument('[body]', 'The reply body (Markdown). Omit to use --message or stdin.')
	.option('-m, --message <text>', 'The reply body, as an alternative to the positional argument.')
	.option('--harness <kind>', `Replying agent: one of ${HARNESSES.join(', ')}.`)
	.option('--name <label>', 'Freeform author name (overrides the harness label).')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runReply);
