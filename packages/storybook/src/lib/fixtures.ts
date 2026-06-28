/**
 * Deterministic fixture builders for the stories. Everything here is pure data
 * shaped to the @super-review/core contract types, so stories stay readable and
 * the "performance" variants can scale a single knob (the item count) without
 * hand-writing hundreds of records.
 *
 * No `Math.random()` — counts and contents are derived from the index so a
 * story renders identically on every load (and Storybook's interaction tests
 * stay stable).
 */
import type {
	BranchInfo,
	ChangedFile,
	CommitInfo,
	DiffData,
	FileStatus,
	GithubAccount,
	PRSummary,
	RepoInfo
} from '@super-review/core/types';

// A spread of realistic-looking source paths to draw from, so the file tree and
// diff stories show nested folders, varied extensions and icons.
const DIRS = [
	'src/components',
	'src/components/ui/button',
	'src/lib/server',
	'src/routes/(app)/settings',
	'packages/core/src',
	'packages/ui/src/components',
	'apps/desktop/src/main',
	'apps/docs/src/routes',
	'tests/integration',
	'scripts'
];

const FILES = [
	['Button', 'svelte'],
	['index', 'ts'],
	['store', 'svelte.ts'],
	['handler', 'ts'],
	['schema', 'json'],
	['styles', 'css'],
	['README', 'md'],
	['config', 'yaml'],
	['logo', 'svg'],
	['utils', 'ts'],
	['service', 'ts'],
	['types', 'd.ts'],
	['page', 'svelte'],
	['migration', 'sql'],
	['Dockerfile', '']
];

const STATUSES: FileStatus[] = ['modified', 'added', 'deleted', 'renamed', 'modified', 'modified'];

function pathFor(i: number): string {
	const dir = DIRS[i % DIRS.length];
	const [name, ext] = FILES[(i * 7) % FILES.length];
	const suffix = i >= FILES.length ? `-${Math.floor(i / FILES.length)}` : '';
	return ext ? `${dir}/${name}${suffix}.${ext}` : `${dir}/${name}${suffix}`;
}

/**
 * Build `count` changed files with a deterministic spread of statuses and
 * additions/deletions. The line counts grow with the index so the diff view's
 * "differently sized files" requirement is met in one pass.
 */
export function makeChangedFiles(count: number): ChangedFile[] {
	return Array.from({ length: count }, (_, i) => {
		const status = STATUSES[i % STATUSES.length];
		// Sizes range from a one-line tweak up to a few-thousand-line file, cycling
		// so a large list contains a realistic mix of small and huge diffs.
		const magnitude = [3, 12, 48, 220, 900, 2400][i % 6];
		const additions = status === 'deleted' ? 0 : magnitude;
		const deletions = status === 'added' ? 0 : Math.floor(magnitude / 3);
		return {
			path: pathFor(i),
			oldPath: status === 'renamed' ? pathFor(i).replace(/(\.\w+)?$/, '.old$&') : undefined,
			status,
			additions,
			deletions,
			isBinary: false,
			contentSig: `sig-${i}`
		};
	});
}

/**
 * A unified-diff patch + old/new contents for a file, sized to `lines`. Used to
 * pre-seed the diff cache so DiffView renders real Pierre diffs without an
 * Electron backend.
 */
export function makeDiffData(file: ChangedFile, lines = 40): DiffData {
	const oldLines = Array.from({ length: lines }, (_, i) => `const value_${i} = ${i};`);
	const newLines = oldLines.map((l, i) =>
		i % 5 === 0 ? `const value_${i} = ${i} + 1; // changed` : l
	);

	const hunkHeader = `@@ -1,${lines} +1,${lines} @@`;
	const body = oldLines
		.map((l, i) => (i % 5 === 0 ? `-${l}\n+${newLines[i]}` : ` ${l}`))
		.join('\n');
	const patch = `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n${hunkHeader}\n${body}`;

	return {
		file,
		patch,
		oldContents: oldLines.join('\n') + '\n',
		newContents: newLines.join('\n') + '\n',
		truncated: false
	};
}

// A deterministic, self-contained brand icon (inline SVG data URL) so RepoIcon
// renders without reaching out to GitHub's avatar CDN — keeps the stories
// hermetic and the console clean.
const ICON_COLORS = ['#ff5a36', '#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];
function repoIcon(name: string, i: number): string {
	const color = ICON_COLORS[i % ICON_COLORS.length];
	const initial = (name[0] ?? '?').toUpperCase();
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="8" fill="${color}"/><text x="20" y="27" font-family="sans-serif" font-size="20" font-weight="700" fill="white" text-anchor="middle">${initial}</text></svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function makeRepos(count: number): RepoInfo[] {
	const names = [
		'super-review',
		'acme-web',
		'design-system',
		'billing-service',
		'mobile-app',
		'infra',
		'docs-site',
		'analytics-pipeline',
		'auth-gateway',
		'playground'
	];
	return Array.from({ length: count }, (_, i) => {
		const name = i < names.length ? names[i] : `project-${i}`;
		return {
			id: `repo-${i}`,
			path: `/Users/dev/code/${name}`,
			name,
			iconDataUrl: repoIcon(name, i),
			githubOwner: 'acme',
			githubRepo: name,
			remoteUrl: `https://github.com/acme/${name}.git`,
			defaultBranch: 'main',
			description: `The ${name} repository`,
			lastOpenedAt: 1_700_000_000_000 - i * 86_400_000
		};
	});
}

export function makeBranches(count: number): BranchInfo[] {
	const prefixes = ['feat', 'fix', 'chore', 'refactor', 'docs', 'release'];
	const topics = [
		'storybook-setup',
		'diff-virtualization',
		'comment-threads',
		'branch-picker',
		'repo-frecency',
		'dark-mode',
		'perf-pass',
		'octokit-bump',
		'session-tours',
		'find-in-diff'
	];
	const base: BranchInfo[] = [
		{
			name: 'main',
			current: true,
			upstream: 'origin/main',
			ahead: 0,
			behind: 0,
			isRemote: false,
			lastCommitAt: 1_700_000_000_000
		}
	];
	const rest = Array.from({ length: Math.max(0, count - 1) }, (_, i) => {
		const prefix = prefixes[i % prefixes.length];
		const topic = topics[i % topics.length];
		const suffix = i >= topics.length ? `-${Math.floor(i / topics.length)}` : '';
		return {
			name: `${prefix}/${topic}${suffix}`,
			current: false,
			upstream: i % 3 === 0 ? `origin/${prefix}/${topic}${suffix}` : undefined,
			ahead: (i * 3) % 12,
			behind: (i * 2) % 7,
			isRemote: false,
			lastCommitAt: 1_700_000_000_000 - (i + 1) * 3_600_000
		} satisfies BranchInfo;
	});
	return [...base, ...rest].slice(0, Math.max(1, count));
}

export function makeCommits(count: number): CommitInfo[] {
	const subjects = [
		'Set up Storybook for the ui package',
		'Fix diff virtualization jank on large files',
		'Add performance stories for the file tree',
		'Refactor the branch picker data flow',
		'Bump @octokit/rest to v21',
		'Tidy up comment thread spacing',
		'Cache parsed diffs per context',
		'Wire the repo picker frecency sort',
		'Document the session tour format',
		'Polish the find-in-diff highlight bands'
	];
	return Array.from({ length: count }, (_, i) => {
		const hash = (i + 1).toString(16).padStart(40, '0');
		return {
			hash,
			shortHash: hash.slice(0, 7),
			subject: subjects[i % subjects.length],
			authorName: i % 2 === 0 ? 'Aidan Bleser' : 'Claude',
			authorEmail: i % 2 === 0 ? 'aidan@example.com' : 'noreply@anthropic.com',
			authoredAt: 1_700_000_000_000 - i * 3_600_000
		};
	});
}

export function makePRs(count: number): PRSummary[] {
	const titles = [
		'Storybook workbench for the ui package',
		'Virtualize the diff view',
		'Comment thread redesign',
		'Frecency-sorted repo picker',
		'Dark mode polish',
		'Find-in-diff highlight API',
		'Session tour authoring',
		'Octokit v21 upgrade',
		'Branch cleanup dialog',
		'Image diff support'
	];
	return Array.from({ length: count }, (_, i) => ({
		number: 1000 + i,
		title: titles[i % titles.length] + (i >= titles.length ? ` (${i})` : ''),
		body: 'This pull request does a thing. See the description for details.',
		author: i % 2 === 0 ? 'aidan' : 'claude-bot',
		authorAvatarUrl: '',
		headRef: `feat/topic-${i}`,
		baseRef: 'main',
		headSha: (i + 1).toString(16).padStart(40, 'a'),
		baseSha: '0'.repeat(40),
		url: `https://github.com/acme/super-review/pull/${1000 + i}`,
		draft: i % 4 === 0,
		updatedAt: new Date(1_700_000_000_000 - i * 3_600_000).toISOString(),
		createdAt: new Date(1_700_000_000_000 - i * 7_200_000).toISOString(),
		state: 'open',
		merged: false
	}));
}

export function makeGithubAccount(): GithubAccount {
	return {
		id: 'gh-1',
		login: 'aidan',
		name: 'Aidan Bleser',
		avatarUrl: '',
		addedAt: 1_700_000_000_000
	};
}

/** Convenience: expose the deterministic path helper to stories. */
export { pathFor };
