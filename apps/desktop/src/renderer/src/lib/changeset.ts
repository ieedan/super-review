// Helpers for treating a changeset file as a commit message source.
//
// A changeset (`.changeset/<name>.md`, written by @changesets/cli) is a YAML
// frontmatter block listing the package bumps, followed by a Markdown body
// describing the change. The body is hand-written and already reads like a
// changelog entry, so the commit box reuses it: when a single new changeset
// lands in the working tree and the box is still empty, its description becomes
// the commit message.

// Leading `---` … `---` frontmatter block (the package-bump table). Mirrors the
// frontmatter matcher in markdown.ts.
const FRONTMATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

// `.changeset/<name>.md`, anywhere the path is rooted. The directory's own
// README.md is excluded by isChangesetPath.
const CHANGESET_PATH_RE = /(?:^|\/)\.changeset\/[^/]+\.md$/i;

/** True when the path is a changeset file (not the `.changeset/README.md`). */
export function isChangesetPath(path: string): boolean {
	if (!CHANGESET_PATH_RE.test(path)) return false;
	return !/(?:^|\/)README\.md$/i.test(path);
}

/**
 * Render the `.changeset/*.md` file contents for a set of package bumps and a
 * markdown body. Mirrors the writer in `@super-review/core` (changesets.ts) so
 * the dialog preview matches the file that gets written byte-for-byte.
 */
export function formatChangesetFile(input: {
	packages: string[];
	bump: 'patch' | 'minor' | 'major';
	description: string;
}): string {
	const frontmatter = input.packages.map((p) => `'${p}': ${input.bump}`).join('\n');
	const body = input.description.trim();
	return `---\n${frontmatter}\n---\n\n${body}\n`;
}

// Small word lists for a changesets-style `adjective-noun-verb` filename. Just
// for the dialog's preview/created name; uniqueness is still enforced server-side.
const SLUG_ADJECTIVES = [
	'brave',
	'calm',
	'clever',
	'eager',
	'fancy',
	'gentle',
	'happy',
	'lucky',
	'mighty',
	'proud',
	'quiet',
	'shy',
	'swift',
	'witty'
];
const SLUG_NOUNS = [
	'apples',
	'badgers',
	'clouds',
	'dragons',
	'foxes',
	'lions',
	'otters',
	'pandas',
	'rivers',
	'rockets',
	'tigers',
	'turtles',
	'waves',
	'zebras'
];
const SLUG_VERBS = [
	'bake',
	'cheer',
	'dance',
	'dream',
	'glow',
	'jump',
	'learn',
	'paint',
	'race',
	'sing',
	'smile',
	'travel',
	'wave',
	'wink'
];

function pick(arr: string[]): string {
	return arr[Math.floor(Math.random() * arr.length)];
}

/** A changesets-style `adjective-noun-verb` slug (no extension). */
export function randomChangesetName(): string {
	return `${pick(SLUG_ADJECTIVES)}-${pick(SLUG_NOUNS)}-${pick(SLUG_VERBS)}`;
}

/**
 * Split a changeset file into a commit summary + description: the first line of
 * the body becomes the summary, the rest the description. Returns null when the
 * source has no frontmatter (so it isn't a real changeset) or an empty body.
 */
export function parseChangesetMessage(
	src: string
): { summary: string; description: string } | null {
	const m = FRONTMATTER_RE.exec(src);
	if (!m) return null;
	const body = src.slice(m[0].length).trim();
	if (!body) return null;
	const lines = body.split(/\r?\n/);
	const summary = lines[0].trim();
	const description = lines.slice(1).join('\n').trim();
	return { summary, description };
}
