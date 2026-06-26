import { getDesktopGithubToken, getDesktopGithubTokenForRepo } from '@super-review/core';

// A single inline review comment as returned by GitHub's REST API, narrowed to
// the fields we render. See
// https://docs.github.com/rest/pulls/comments#list-review-comments-on-a-pull-request
export interface GithubReviewComment {
	id: number;
	body: string;
	path: string;
	line: number | null;
	start_line: number | null;
	original_line: number | null;
	in_reply_to_id?: number;
	user: { login: string } | null;
	html_url: string;
	created_at: string;
}

// Resolve a GitHub token: prefer the desktop app's sign-in, then fall back to
// the usual CI/CLI env vars. Returns null when neither is available. Pass the
// repo root so the app's per-repo account pin is honored (e.g. a private repo
// owned by a secondary account); without it the active account is used.
export function resolveGithubToken(repoPath?: string): string | null {
	const fromApp = repoPath ? getDesktopGithubTokenForRepo(repoPath) : getDesktopGithubToken();
	if (fromApp) return fromApp.token;
	return process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? null;
}

// A pull request, narrowed to what branch detection needs.
export interface GithubPullRequest {
	number: number;
	title: string;
	head: { ref: string } | null;
}

// Parse the `rel="next"` link out of a paginated response's Link header.
function nextPageUrl(linkHeader: string | null): string | null {
	if (!linkHeader) return null;
	for (const part of linkHeader.split(',')) {
		const m = part.match(/<([^>]+)>;\s*rel="next"/);
		if (m) return m[1];
	}
	return null;
}

// Single GitHub GET with our standard headers and error mapping. Throws an Error
// with a human-readable message on auth/HTTP failures so the command can
// `fail()` cleanly. `notFound` customizes the 404 message for the resource.
async function ghGet(url: string, token: string, notFound: string): Promise<Response> {
	const res = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		}
	});
	if (!res.ok) {
		if (res.status === 401) throw new Error('GitHub rejected the token (401). Sign in again.');
		if (res.status === 404) throw new Error(notFound);
		throw new Error(`GitHub request failed: ${res.status} ${res.statusText}`);
	}
	return res;
}

// The open pull request whose head branch is `branch`, or null when there's
// none. Tries the exact `head=owner:branch` filter first (same-repo PRs), then
// falls back to scanning open PRs by head ref so PRs from forks still match.
export async function findOpenPrForBranch(
	owner: string,
	repo: string,
	branch: string,
	token: string
): Promise<GithubPullRequest | null> {
	const base = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`;
	const notFound = `${owner}/${repo} not found (or the token can't see it)`;

	const exactRes = await ghGet(`${base}&head=${owner}:${branch}`, token, notFound);
	const exact = (await exactRes.json()) as GithubPullRequest[];
	const byHead = exact.find((p) => p.head?.ref === branch);
	if (byHead) return byHead;

	const allRes = await ghGet(base, token, notFound);
	const all = (await allRes.json()) as GithubPullRequest[];
	return all.find((p) => p.head?.ref === branch) ?? null;
}

// Fetch every inline review comment on a pull request, following pagination.
export async function listPullRequestReviewComments(
	owner: string,
	repo: string,
	prNumber: number,
	token: string
): Promise<GithubReviewComment[]> {
	const out: GithubReviewComment[] = [];
	const notFound = `pull request #${prNumber} not found on ${owner}/${repo} (or the token can't see it)`;
	let url: string | null =
		`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`;

	while (url) {
		const res = await ghGet(url, token, notFound);
		out.push(...((await res.json()) as GithubReviewComment[]));
		url = nextPageUrl(res.headers.get('link'));
	}
	return out;
}
