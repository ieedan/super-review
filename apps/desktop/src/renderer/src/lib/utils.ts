import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

// True when a keyboard event lands in a text-entry context (an input, textarea,
// or contenteditable). Used to keep bare-key shortcuts from hijacking typing.
export function isEditableTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

// Helpers used by shadcn-svelte components when wrapping bits-ui primitives.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

// Tailwind classes that pair a saturated background with readable foreground.
// Used as a placeholder "favicon" when a repo has no icon file we can find.
const REPO_PLACEHOLDER_TONES = [
	'bg-rose-500/85 text-white',
	'bg-orange-500/85 text-white',
	'bg-amber-500/85 text-white',
	'bg-emerald-500/85 text-white',
	'bg-teal-500/85 text-white',
	'bg-sky-500/85 text-white',
	'bg-indigo-500/85 text-white',
	'bg-violet-500/85 text-white',
	'bg-fuchsia-500/85 text-white'
];

export function repoPlaceholder(name: string): { initial: string; toneClass: string } {
	const trimmed = name.trim();
	const initial = (trimmed.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
	let hash = 0;
	for (let i = 0; i < trimmed.length; i++) {
		hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
	}
	const toneClass = REPO_PLACEHOLDER_TONES[hash % REPO_PLACEHOLDER_TONES.length];
	return { initial, toneClass };
}

// VSCode-style file tree sort: at each level, folders sort before files, then
// alphabetically within each group. A plain string compare on full paths
// interleaves siblings (since '/' > '.') — e.g. `b.txt` lands before `b/c.txt`
// even though `b/` is conceptually a folder sibling that should come first.
export function comparePathsVSCodeStyle(a: string, b: string): number {
	const aParts = a.split('/');
	const bParts = b.split('/');
	const minLen = Math.min(aParts.length, bParts.length);
	for (let i = 0; i < minLen; i++) {
		const aIsLast = i === aParts.length - 1;
		const bIsLast = i === bParts.length - 1;
		// One side has run out of folders and is the file; the other still has
		// folders left. The deeper one is inside a folder at this level, which
		// sorts before a file sibling.
		if (aIsLast !== bIsLast) return aIsLast ? 1 : -1;
		const cmp = aParts[i].localeCompare(bParts[i]);
		if (cmp !== 0) return cmp;
	}
	return 0;
}

// Group repos by GitHub owner, bucketing owner-less repos under `otherOwner`.
// Lives in this plain module so its grouping Map stays an ordinary,
// non-reactive Map.
export function groupReposByOwner<T extends { githubOwner?: string | null }>(
	repos: T[],
	otherOwner: string
): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const repo of repos) {
		const owner = repo.githubOwner?.trim() || otherOwner;
		const bucket = groups.get(owner);
		if (bucket) bucket.push(repo);
		else groups.set(owner, [repo]);
	}
	return groups;
}

// Use the platform's localized relative-time formatter rather than rolling our
// own. `narrow` keeps the compact look ("5m ago", "7d ago") while extending
// cleanly past a month ("1mo ago", "2y ago") instead of falling back to an
// absolute date. Constructed once since these strings re-derive on every tick.
const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, {
	numeric: 'always',
	style: 'narrow'
});

// Largest unit first so we pick the coarsest one that fits. Thresholds match
// the previous hand-rolled behavior (minutes < 60, hours < 24, days < 30).
const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
	['year', 365 * 24 * 60 * 60 * 1000],
	['month', 30 * 24 * 60 * 60 * 1000],
	['day', 24 * 60 * 60 * 1000],
	['hour', 60 * 60 * 1000],
	['minute', 60 * 1000]
];

export function formatRelative(iso: string): string {
	const then = new Date(iso).getTime();
	const now = Date.now();
	const diff = Math.max(0, now - then);
	for (const [unit, ms] of RELATIVE_UNITS) {
		if (diff >= ms) return relativeTimeFormat.format(-Math.floor(diff / ms), unit);
	}
	return 'just now';
}
