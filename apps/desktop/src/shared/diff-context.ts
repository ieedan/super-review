import type { DiffContext } from './types.js';

export function diffContextKey(ctx: DiffContext): string {
	switch (ctx.kind) {
		case 'workingTree':
			return 'workingTree';
		case 'branch':
			return `branch:${ctx.base}..${ctx.head}`;
		case 'pr':
			return `pr:${ctx.prNumber}`;
		case 'session':
			return `session:${ctx.sessionId}`;
		case 'stash':
			return `stash:${ctx.ref}`;
		case 'commit':
			return `commit:${ctx.ref}`;
	}
}

// Key for per-view *review state* — which files are marked seen / collapsed.
// Unlike `diffContextKey`, a branch's key omits the diff base: "have I seen this
// file on this branch" is about the branch head, not which base it happens to be
// diffed against. The base resolves asynchronously (the local default branch
// first, then the PR's pinned `pr/<n>/base` once a network lookup lands), so
// keying review state by it made the seen markers load under the wrong key and
// only appear once the base settled ~1s later. Head-only is stable from the
// first paint. Every other context matches `diffContextKey`.
export function reviewContextKey(ctx: DiffContext): string {
	if (ctx.kind === 'branch') return `branch:${ctx.head}`;
	return diffContextKey(ctx);
}
