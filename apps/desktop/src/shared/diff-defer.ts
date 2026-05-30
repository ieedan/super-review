import type { ChangedFile } from './types.js';

// Default ceiling on a diff's changed-line count (additions + deletions) before
// it's hidden behind a "Load diff" button. User-configurable in settings.
export const DEFAULT_MAX_DIFF_LINES = 1500;

// Files whose diffs are hidden behind a "Load diff" button by default. These
// seed the user-configurable list — lock files are machine-generated and
// rarely worth reading in a review, yet are often huge. Users can add their
// own patterns (e.g. build outputs) or remove these.
//
// Patterns are glob-style:
//   - no slash → matched against the file's basename anywhere in the tree
//     (e.g. `*.lock`, `package-lock.json`)
//   - contains a slash → matched against the full repo-relative path
//     (e.g. `dist/**`, `**/*.min.js`)
// `*` matches within a path segment, `**` matches across segments, `?` matches
// a single non-slash char. Matching is case-insensitive.
export const DEFAULT_HIDDEN_DIFF_PATTERNS: string[] = [
	// JS / TS
	'package-lock.json',
	'npm-shrinkwrap.json',
	'yarn.lock',
	'pnpm-lock.yaml',
	'bun.lockb',
	'bun.lock',
	// Rust
	'Cargo.lock',
	// PHP
	'composer.lock',
	// Ruby
	'Gemfile.lock',
	// Python
	'poetry.lock',
	'pdm.lock',
	'Pipfile.lock',
	'uv.lock',
	// Go
	'go.sum',
	// Nix
	'flake.lock',
	// .NET
	'packages.lock.json',
	// Elixir
	'mix.lock',
	// Dart / Flutter
	'pubspec.lock',
	// CocoaPods
	'Podfile.lock',
	// Gradle
	'gradle.lockfile'
];

const REGEXP_SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

const compiledCache = new Map<string, RegExp>();

function globToRegExp(glob: string): RegExp {
	const cached = compiledCache.get(glob);
	if (cached) return cached;

	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === '*') {
			if (glob[i + 1] === '*') {
				// `**` spans path separators.
				re += '.*';
				i++;
				// Swallow a trailing slash so `dist/**` also matches `dist`.
				if (glob[i + 1] === '/') i++;
			} else {
				re += '[^/]*';
			}
		} else if (c === '?') {
			re += '[^/]';
		} else if (REGEXP_SPECIAL.has(c)) {
			re += `\\${c}`;
		} else {
			re += c;
		}
	}

	const compiled = new RegExp(`^${re}$`, 'i');
	compiledCache.set(glob, compiled);
	return compiled;
}

export function matchesHiddenPattern(path: string, patterns: string[]): boolean {
	const base = path.split('/').pop() ?? path;
	for (const raw of patterns) {
		const pattern = raw.trim();
		if (!pattern) continue;
		// A slash anchors the pattern to the full path; otherwise it's a basename
		// match so `package-lock.json` catches the file in any directory.
		const target = pattern.includes('/') ? path : base;
		if (globToRegExp(pattern).test(target)) return true;
	}
	return false;
}

export type DiffDeferReason = 'pattern' | 'too-large';

// Decide whether a file's diff should be hidden behind a "Load diff" button by
// default. Returns the reason, or null when the diff should render normally.
//
// Size is measured by the diff's changed-line count (additions + deletions),
// not the file's total length — a 5000-line file with a 3-line change renders
// inline, while a 2000-line rewrite is deferred.
export function diffDeferReason(
	file: ChangedFile,
	maxDiffLines: number,
	hiddenPatterns: string[]
): DiffDeferReason | null {
	if (matchesHiddenPattern(file.path, hiddenPatterns)) return 'pattern';
	if (maxDiffLines > 0 && file.additions + file.deletions > maxDiffLines) {
		return 'too-large';
	}
	return null;
}
