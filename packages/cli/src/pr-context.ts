import path from 'node:path';
import { getCurrentBranch, resolveGithubRepo } from '@super-review/core';
import { fail, repoRoot } from './util';
import { findOpenPrForBranch, resolveGithubToken } from './github';

// Everything the `--pr` comment commands need to talk to GitHub: the repo root,
// the owner/repo parsed from `origin`, a token, and the resolved PR number.
export interface PrContext {
	root: string;
	owner: string;
	repo: string;
	token: string;
	prNumber: number;
}

// Turn a commander `--pr [number]` value into an explicit PR number or `null`
// ("detect from the branch"). `--pr` alone is the boolean `true`; `--pr <n>` is
// the number as a string. Exits via `fail` on a non-positive-integer value.
export function parsePrNumber(pr: string | boolean): number | null {
	if (typeof pr !== 'string') return null;
	const n = Number(pr);
	if (!Number.isInteger(n) || n <= 0) {
		fail(`invalid --pr value: ${pr} (expected a positive integer)`);
	}
	return n;
}

// Resolve the GitHub context for a `--pr` command: repo root, owner/repo from
// `origin`, a token (the app's sign-in or GH_TOKEN/GITHUB_TOKEN), and the target
// PR number. With `explicitNumber` null, finds the open PR whose head is the
// current branch and announces the choice on stderr so stdout stays clean.
export async function resolvePrContext(
	cwd: string,
	explicitNumber: number | null
): Promise<PrContext> {
	const root = await repoRoot(path.resolve(cwd));

	const slug = await resolveGithubRepo(root);
	if (!slug) fail("couldn't determine the GitHub owner/repo from the 'origin' remote");

	const token = resolveGithubToken(root);
	if (!token) {
		fail(
			'no GitHub token available. Sign in with the Super Review app, or set GH_TOKEN/GITHUB_TOKEN.'
		);
	}

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

	return { root, owner: slug.owner, repo: slug.repo, token, prNumber };
}
