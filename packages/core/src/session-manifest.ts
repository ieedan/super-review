// Super-review session manifests live at `.super-review/sessions/<id>.json`.
// Their diffs are deferred by default (the `.super-review/sessions/*` hidden
// pattern), and the diff view turns the placeholder into a clickable session
// card instead of raw JSON — so we need to recover the session id from the path.

// Tolerate an optional leading path prefix; the file's id is the basename
// without the `.json` extension.
const MANIFEST_RE = /(?:^|\/)\.super-review\/sessions\/([^/]+)\.json$/i;

// Extract the session id from a manifest path, or null when the path isn't a
// session manifest.
export function sessionIdFromManifestPath(path: string): string | null {
	const match = MANIFEST_RE.exec(path);
	return match ? match[1] : null;
}

// Branch task lists live at `.super-review/tasks/<slug>.json`. Like session
// manifests their raw JSON diff is deferred by default (`.super-review/tasks/*`)
// and the diff view renders a checklist card instead, so the diff machinery needs
// to recognise the path.
const TASK_MANIFEST_RE = /(?:^|\/)\.super-review\/tasks\/([^/]+)\.json$/i;

// True when the path is a branch task list manifest.
export function isTaskManifestPath(path: string): boolean {
	return TASK_MANIFEST_RE.test(path);
}
