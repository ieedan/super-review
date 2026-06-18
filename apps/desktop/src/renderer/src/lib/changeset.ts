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
