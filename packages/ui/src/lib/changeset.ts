// `.changeset/<name>.md` (written by @changesets/cli), anywhere the path is
// rooted. The directory's own README.md is excluded. Mirrors the desktop app's
// isChangesetPath — kept here so the file-icon resolver is self-contained.
const CHANGESET_PATH_RE = /(?:^|\/)\.changeset\/[^/]+\.md$/i;

/** True when the path is a changeset file (not the `.changeset/README.md`). */
export function isChangesetPath(path: string): boolean {
	if (!CHANGESET_PATH_RE.test(path)) return false;
	return !/(?:^|\/)README\.md$/i.test(path);
}
