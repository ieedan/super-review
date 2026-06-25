import { SvelteMap } from 'svelte/reactivity';
import type { CommitAuthorIdentity, CommitInfo } from '@super-review/core/types';

// Resolves a commit author's display username and avatar from their git email.
//
// Three sources, best first:
//  1. The email itself. GitHub's noreply emails encode the account:
//     `<id>+<login>@users.noreply.github.com` gives both the login and the avatar
//     (by id), and the older `<login>@users.noreply.github.com` form gives the
//     login. This needs no network and works offline.
//  2. The GitHub API, for emails the email can't decode. GitHub maps a commit
//     email to an account through its user database (e.g. `noreply@anthropic.com`
//     -> the `claude` account), which we can't reproduce locally — so we ask the
//     API the same way GitHub's own commit list does.
//  3. A generated Gravatar identicon, for authors with no GitHub account (or when
//     we're offline / not on GitHub) — mirroring what GitHub renders for an
//     unknown email instead of a bare initial.

const GITHUB_EMAIL_WITH_ID = /^(\d+)\+([^@]+)@users\.noreply\.github\.com$/i;
const GITHUB_EMAIL_WITH_LOGIN = /^([^@]+)@users\.noreply\.github\.com$/i;

// GitHub-resolved identities, keyed by normalized email. Reactive so avatars and
// usernames fill in as the API responds.
const identityCache = new SvelteMap<string, CommitAuthorIdentity>();
// Gravatar identicon URLs, keyed by normalized email — also async (the hash is),
// also reactive.
const identiconCache = new SvelteMap<string, string>();
// Emails we've already resolved (identity found or confirmed absent) and ones in
// flight, so we never re-probe the API for the same author. Deliberately plain
// (non-reactive) Sets: they gate work, they don't drive rendering, and they're
// mutated from inside the resolving $effect — making them reactive would re-fire
// it on every bookkeeping change.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const resolved = new Set<string>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const inFlight = new Set<string>();

const normalize = (email: string): string => email.trim().toLowerCase();

// The GitHub login encoded in an author's email, or null when it isn't a GitHub
// noreply address.
export function githubLogin(email: string): string | null {
	const withId = email.match(GITHUB_EMAIL_WITH_ID);
	if (withId) return withId[2];
	const withLogin = email.match(GITHUB_EMAIL_WITH_LOGIN);
	if (withLogin) return withLogin[1];
	return null;
}

// The author's GitHub profile picture derived from their email, or null when the
// email isn't a GitHub noreply address.
function githubAvatarFromEmail(email: string): string | null {
	const withId = email.match(GITHUB_EMAIL_WITH_ID);
	// Bot accounts are GitHub Apps: their avatar lives at /in/<app-install-id>, not
	// /u/<user-id>, and only the API can map it. The /u/<id> form returns a generic
	// 200 image, which would mask the API lookup — so let bots fall through to it.
	if (withId) {
		if (withId[2].endsWith('[bot]')) return null;
		return `https://avatars.githubusercontent.com/u/${withId[1]}?s=80&v=4`;
	}
	const withLogin = email.match(GITHUB_EMAIL_WITH_LOGIN);
	if (withLogin) {
		if (withLogin[1].endsWith('[bot]')) return null;
		return `https://github.com/${withLogin[1]}.png?size=80`;
	}
	return null;
}

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Compute and cache the Gravatar identicon URL for an email (once).
function primeIdenticon(key: string): void {
	if (identiconCache.has(key)) return;
	identiconCache.set(key, ''); // mark in-flight so we don't re-hash
	void sha256Hex(key).then((hash) => {
		identiconCache.set(key, `https://www.gravatar.com/avatar/${hash}?d=identicon&s=80`);
	});
}

// Resolve avatars/usernames for the given commits. Emails the email itself
// decodes (GitHub noreply) need nothing. The rest are probed against the GitHub
// API in one batch (a few commit SHAs per unseen author); whatever GitHub can't
// map falls back to an identicon. Call from an $effect over the commits on screen.
export function ensureAvatars(repoId: string | undefined, commits: CommitInfo[]): void {
	// One entry per unseen, non-self-describing email: a few of that author's
	// SHAs (newest first) for the API to probe. Transient local scratch, not state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const candidates = new Map<string, string[]>();
	for (const commit of commits) {
		if (githubAvatarFromEmail(commit.authorEmail)) continue;
		const key = normalize(commit.authorEmail);
		if (resolved.has(key) || inFlight.has(key)) continue;
		const shas = candidates.get(key) ?? [];
		if (shas.length < 5) shas.push(commit.hash);
		candidates.set(key, shas);
	}
	if (candidates.size === 0) return;
	for (const key of candidates.keys()) inFlight.add(key);

	// No repo context (or no GitHub repo): skip the API and use identicons.
	if (!repoId) {
		for (const key of candidates.keys()) {
			inFlight.delete(key);
			resolved.add(key);
			primeIdenticon(key);
		}
		return;
	}

	const payload = Array.from(candidates, ([email, shas]) => ({ email, shas }));
	window.api.github
		.resolveCommitAuthors(repoId, payload)
		.then((found) => {
			for (const key of candidates.keys()) {
				inFlight.delete(key);
				resolved.add(key);
				const identity = found[key];
				if (identity) identityCache.set(key, identity);
				else primeIdenticon(key); // GitHub couldn't map it — generate an identicon.
			}
		})
		.catch(() => {
			// Transient failure: allow a later retry, but show an identicon for now.
			for (const key of candidates.keys()) {
				inFlight.delete(key);
				primeIdenticon(key);
			}
		});
}

// The best avatar URL for an author: their GitHub picture (from the email or the
// API), else the cached identicon. Returns '' until an async source resolves, so
// callers show initials in the meantime.
export function commitAvatarUrl(email: string): string {
	const fromEmail = githubAvatarFromEmail(email);
	if (fromEmail) return fromEmail;
	const key = normalize(email);
	return identityCache.get(key)?.avatarUrl ?? identiconCache.get(key) ?? '';
}

// What to label the author as: their GitHub username when we can derive or
// resolve it, otherwise their commit display name.
export function commitAuthorLabel(commit: CommitInfo): string {
	return (
		githubLogin(commit.authorEmail) ??
		identityCache.get(normalize(commit.authorEmail))?.login ??
		commit.authorName
	);
}
