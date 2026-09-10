/**
 * Harness for the add-repository dialog's clone flow.
 *
 * The real flow reaches the main process for the destination folder it suggests
 * (`repos.getCreateDefaults`), for the repositories the picker lists
 * (`github.listAccountRepositories`), and for what already sits at the chosen
 * destination (`repos.inspectClonePath`). Storybook's blanket api stub resolves
 * all three to `undefined`, which would leave the picker permanently empty, so
 * this installs them over it — with an optional delay so the loading state is
 * reachable, and a map of destinations that are already taken so the blocked
 * state is too.
 */
import type { ClonePathState, RemoteRepoSummary } from '@super-review/core/types';

/** The repositories each account id lists, in the order GitHub returns them. */
export type RepoListing = Record<string, Partial<RemoteRepoSummary>[]>;

/** Destination folder names that already exist, by what's in them. */
export type OccupiedPaths = Record<string, 'files' | 'repo'>;

let listings: RepoListing = {};
let delayMs = 0;
let occupied: OccupiedPaths = {};
let installed = false;

/** Fill in the fields a story doesn't care about. */
function toSummary(repo: Partial<RemoteRepoSummary>): RemoteRepoSummary {
	const owner = repo.owner ?? 'unknown';
	const name = repo.name ?? 'repo';
	return {
		owner,
		name,
		// Real avatars for owners that exist on github.com; the rest 404 and fall
		// back to initials, which is what the picker shows for them anyway.
		ownerAvatarUrl: repo.ownerAvatarUrl ?? `https://github.com/${owner}.png?size=64`,
		description: repo.description,
		cloneUrl: repo.cloneUrl ?? `https://github.com/${owner}/${name}.git`,
		private: repo.private ?? false,
		fork: repo.fork ?? false,
		archived: repo.archived ?? false,
		pushedAt: repo.pushedAt
	};
}

/** Point the mock at a story's listings (and how slowly they arrive). */
export function installAddRepoMock(
	next: RepoListing,
	nextDelayMs = 0,
	nextOccupied: OccupiedPaths = {}
): void {
	listings = next;
	delayMs = nextDelayMs;
	occupied = nextOccupied;
	install();
}

function install(): void {
	if (installed || typeof window === 'undefined') return;
	installed = true;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const w = window as any;
	const base = w.api;

	const github = new Proxy(
		{},
		{
			get(_t, prop) {
				if (prop !== 'listAccountRepositories') return base?.github?.[prop];
				return async (accountId: string, _force?: boolean): Promise<RemoteRepoSummary[]> => {
					if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
					return (listings[accountId] ?? []).map(toSummary);
				};
			}
		}
	);

	const repos = new Proxy(
		{},
		{
			get(_t, prop) {
				if (prop === 'getCreateDefaults') {
					return async () => ({
						defaultPath: '/Users/you/Documents/GitHub',
						gitignores: ['Node', 'Rust', 'Go'],
						licenses: ['MIT', 'Apache-2.0']
					});
				}
				if (prop === 'inspectClonePath') {
					return async (target: string): Promise<ClonePathState> => {
						const name = target.split(/[/\\]/).pop() ?? '';
						const kind = occupied[name];
						if (!kind) return { exists: false, empty: true, isGitRepo: false };
						return { exists: true, empty: false, isGitRepo: kind === 'repo' };
					};
				}
				return base?.repos?.[prop];
			}
		}
	);

	w.api = new Proxy(base ?? {}, {
		get(target, prop) {
			if (prop === 'github') return github;
			if (prop === 'repos') return repos;
			return Reflect.get(target, prop);
		}
	});
}
