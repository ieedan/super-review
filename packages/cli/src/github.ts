import { getDesktopGithubToken, getDesktopGithubTokenForRepo } from '@super-review/core';

// A single inline review comment as returned by GitHub's REST API, narrowed to
// the fields we render. See
// https://docs.github.com/rest/pulls/comments#list-review-comments-on-a-pull-request
//
// `isOutdated` and `isResolved` are not REST fields — we compute them (see
// `listPullRequestReviewComments`) so the listing can mark and filter threads
// the way the desktop app does.
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
	// The comment no longer maps into the current diff. GitHub nulls the live
	// `line` while keeping `original_line`, matching GraphQL's `outdated` flag.
	isOutdated: boolean;
	// Thread-level resolution, fetched from GraphQL (`reviewThreads`) since REST
	// has no notion of it. `null` when the thread state couldn't be determined
	// (e.g. the GraphQL call failed), so callers can distinguish "open" from
	// "unknown".
	isResolved: boolean | null;
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

// The raw REST shape, before we stamp on the computed `isOutdated`/`isResolved`.
type RestReviewComment = Omit<GithubReviewComment, 'isOutdated' | 'isResolved'>;

// A single GraphQL POST against api.github.com, returning the `data` payload.
// Throws on HTTP failure or GraphQL `errors` so the caller can fall back.
async function ghGraphql(
	query: string,
	variables: Record<string, unknown>,
	token: string
): Promise<unknown> {
	const res = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ query, variables })
	});
	if (!res.ok) throw new Error(`GitHub GraphQL request failed: ${res.status} ${res.statusText}`);
	const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
	if (json.errors?.length) throw new Error(`GitHub GraphQL error: ${json.errors[0].message}`);
	return json.data;
}

// Thread-level resolution lives only in GraphQL (`reviewThreads`), so we fetch
// the PR's threads and build a `databaseId → isResolved` map. The REST comment
// `id` equals the GraphQL `databaseId`, which lets us stamp resolution onto the
// REST comments. Paginated over threads. Mirrors the desktop app's
// `fetchThreadInfoByCommentId`.
async function fetchResolutionByCommentId(
	owner: string,
	repo: string,
	prNumber: number,
	token: string
): Promise<Map<number, boolean>> {
	const query = `
    query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              isResolved
              comments(first: 100) {
                nodes { databaseId }
              }
            }
          }
        }
      }
    }`;

	const map = new Map<number, boolean>();
	let cursor: string | null = null;
	for (;;) {
		const data = (await ghGraphql(query, { owner, repo, number: prNumber, cursor }, token)) as {
			repository?: {
				pullRequest?: {
					reviewThreads?: {
						pageInfo?: { hasNextPage?: boolean; endCursor?: string };
						nodes?: { isResolved: boolean; comments?: { nodes?: { databaseId?: number }[] } }[];
					};
				};
			};
		};
		const threads = data?.repository?.pullRequest?.reviewThreads;
		if (!threads) break;
		for (const t of threads.nodes ?? []) {
			for (const c of t.comments?.nodes ?? []) {
				if (c?.databaseId != null) map.set(c.databaseId, t.isResolved);
			}
		}
		if (!threads.pageInfo?.hasNextPage || !threads.pageInfo.endCursor) break;
		cursor = threads.pageInfo.endCursor;
	}
	return map;
}

// Fetch every inline review comment on a pull request, following pagination,
// then enrich each with `isOutdated` (computed from the REST line anchors) and
// `isResolved` (from the PR's GraphQL review threads).
export async function listPullRequestReviewComments(
	owner: string,
	repo: string,
	prNumber: number,
	token: string
): Promise<GithubReviewComment[]> {
	const raw: RestReviewComment[] = [];
	const notFound = `pull request #${prNumber} not found on ${owner}/${repo} (or the token can't see it)`;
	let url: string | null =
		`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`;

	while (url) {
		const res = await ghGet(url, token, notFound);
		raw.push(...((await res.json()) as RestReviewComment[]));
		url = nextPageUrl(res.headers.get('link'));
	}

	// Resolution is best-effort: if GraphQL fails (token scope, GHE without
	// GraphQL, a transient error) we still return the comments, just with
	// `isResolved: null` rather than failing the whole listing.
	let resolution: Map<number, boolean>;
	try {
		resolution = await fetchResolutionByCommentId(owner, repo, prNumber, token);
	} catch (err) {
		console.error(
			`warning: couldn't fetch thread resolution: ${err instanceof Error ? err.message : String(err)}`
		);
		resolution = new Map();
	}

	return raw.map((c) => ({
		...c,
		// Outdated = the comment had a line anchor (`original_line`) that no longer
		// maps into the current diff, so GitHub nulls the live `line`. Requiring
		// `original_line` excludes genuine file-level comments (no line anchor).
		isOutdated: c.line == null && c.original_line != null,
		isResolved: resolution.has(c.id) ? (resolution.get(c.id) ?? false) : null
	}));
}
