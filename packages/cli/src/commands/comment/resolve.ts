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

const HARNESSES: HarnessKind[] = ['claude-code', 'cursor', 'codex', 'opencode', 'copilot', 'other'];

interface ResolveOptions {
	harness?: string;
	name?: string;
	session?: string;
	cwd?: string;
}

async function runResolve(id: string, opts: ResolveOptions): Promise<void> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);

	if (opts.harness && !HARNESSES.includes(opts.harness as HarnessKind)) {
		fail(`invalid --harness "${opts.harness}". Expected one of: ${HARNESSES.join(', ')}`);
	}
	const harness = opts.harness as HarnessKind | undefined;

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

async function runUnresolve(id: string, opts: { cwd?: string }): Promise<void> {
	const cwd = path.resolve(opts.cwd ?? process.cwd());
	const root = await repoRoot(cwd);
	const updated = await unresolveComment(root, id);
	if (!updated) fail(`no comment with id "${id}" in this repo`);
	console.log(`unresolved comment ${updated.id}`);
}

export const resolve = new Command('resolve')
	.description('mark a local review comment as resolved')
	.argument('<id>', 'The comment id (from `comment list`).')
	.option('--harness <kind>', `Resolving agent: one of ${HARNESSES.join(', ')}.`)
	.option('--name <label>', 'Freeform resolver name (overrides the harness label).')
	.option(
		'--session <id>',
		'Link the session that documents the fix, so the reviewer can jump to it.'
	)
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runResolve);

export const unresolve = new Command('unresolve')
	.description('clear a local review comment’s resolved state')
	.argument('<id>', 'The comment id (from `comment list`).')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runUnresolve);
