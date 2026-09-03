import type { Hotkeys } from './hotkeys.js';
import type { RepoUsageStats, StatMetric } from './usage-stats.js';

// Re-exported so renderer/main code can reach the usage-stats types through the
// same `@super-review/core/types` (and `@shared/types`) surface as everything
// else. The pure helpers live in the `./usage-stats` subpath.
export type { RepoUsageStats, StatMetric } from './usage-stats.js';

export interface RepoInfo {
	id: string;
	path: string;
	name: string;
	// The repo's brand icon as a `data:` URL. When the repo ships a light/dark
	// pair (e.g. `favicon-light.svg` + `favicon-dark.svg`), this holds the
	// light-theme variant and `iconDataUrlDark` the dark one; otherwise this is
	// the single detected icon and `iconDataUrlDark` is unset.
	iconDataUrl?: string;
	iconDataUrlDark?: string;
	remoteUrl?: string;
	githubOwner?: string;
	githubRepo?: string;
	// When this repo is a fork, the parent ("upstream") repo's owner/name as
	// reported by the GitHub API. Lets the UI offer the upstream's PRs alongside
	// the fork's own. Unset when the repo isn't a fork (or hasn't been checked).
	upstreamOwner?: string;
	upstreamRepo?: string;
	defaultBranch?: string;
	// One-line repo description from `.git/description` (the create-repo form
	// seeds it). Used to pre-fill the Publish Repository dialog. Unset when it's
	// empty or still git's default placeholder.
	description?: string;
	lastOpenedAt: number;
	// GitHub account this project is pinned to. When unset, the app-wide default
	// (activeGithubAccountId) is used instead.
	githubAccountId?: string;
	// Absolute path of a linked worktree the app is currently "inside" for this
	// repo. While set, working-tree operations (status, staging, commit, pull,
	// sessions, …) run against this checkout instead of `path`, so a branch an
	// agent has checked out in a worktree reviews like any other branch. Ref
	// reads are identical either way (worktrees share the object db and refs).
	// Cleared by any real `git checkout`, which always targets `path`.
	activeWorktreePath?: string;
}

// Author/committer identity applied to a commit, derived from the GitHub
// account a project authenticates as.
export interface GitIdentity {
	name: string;
	email: string;
}

// SSH signing material for a commit. `keyPath` is the absolute path to the
// private signing key (its `.pub` sits alongside). Git signs via
// `gpg.format=ssh` + `user.signingkey`, applied as per-invocation `-c`
// overrides so the repo's and the user's global git config are never touched.
export interface CommitSigning {
	keyPath: string;
}

export interface BranchInfo {
	name: string;
	current: boolean;
	upstream?: string;
	ahead?: number;
	behind?: number;
	isRemote: boolean;
	// Unix epoch ms of the branch tip's committer date. Undefined when git
	// didn't return a parseable date (very rare — corrupted ref, etc.).
	lastCommitAt?: number;
	// Absolute path of the linked worktree this branch is checked out in, when
	// that worktree isn't the repo itself. Such a branch can't be checked out
	// here (git refuses: "already used by worktree"), so it's viewed read-only.
	worktreePath?: string;
}

// A single commit in the History tab's list. Lightweight metadata only — the
// commit's changed files and diffs are fetched lazily through a `commit`
// DiffContext when the commit is opened.
export interface CommitInfo {
	// Full 40-char commit SHA. Used as the stable list key and as the ref a
	// `commit` DiffContext diffs (`<hash>^..<hash>`).
	hash: string;
	// Abbreviated SHA for display.
	shortHash: string;
	// First line of the commit message.
	subject: string;
	// Author (not committer) name and email — who wrote the change.
	authorName: string;
	authorEmail: string;
	// Unix epoch ms of the author date.
	authoredAt: number;
}

// A commit author resolved to a GitHub account — login + avatar — the way
// GitHub's own commit list resolves authors from the commit email. We can't
// always derive this from the email (e.g. `noreply@anthropic.com` only maps to
// the `claude` account via GitHub's user database), so it comes from the API.
export interface CommitAuthorIdentity {
	login: string;
	avatarUrl: string;
}

// A local branch that no longer lives on any remote — a candidate for "Clean Up
// Local Branches". It either never tracked a remote, or its upstream is "gone"
// (the remote branch was deleted and pruned, e.g. after a PR merged). The
// checked-out branch is never included (git refuses to delete it).
export interface LocalOnlyBranch {
	name: string;
	// Unix epoch ms of the branch tip's committer date (see BranchInfo).
	lastCommitAt?: number;
	// The configured tracking ref that no longer resolves (e.g. "origin/feat"),
	// or undefined when the branch never tracked a remote at all.
	goneUpstream?: string;
	// How many stash entries were created on this branch (any stash, not just the
	// app's managed ones), so the cleanup dialog can warn before deleting work
	// the user parked there. Deleting a branch never drops its stashes.
	stashCount: number;
}

export type FileStatus =
	| 'added'
	| 'modified'
	| 'deleted'
	| 'renamed'
	| 'copied'
	| 'untracked'
	| 'type-change';

export interface ChangedFile {
	path: string;
	oldPath?: string;
	status: FileStatus;
	additions: number;
	deletions: number;
	isBinary: boolean;
	// A content-derived fingerprint of the file's current (head/worktree) state,
	// used to detect when a file marked "seen" has actually changed since — even
	// an in-place edit that keeps the same +/- counts. For committed contexts
	// (branch/PR/commit/stash) it's the destination blob OID, which git already
	// has; for the working tree it's the blob hash git computes for the diff. May
	// be undefined when git can't supply one (e.g. a deleted file), in which case
	// callers fall back to the stat-based signature.
	contentSig?: string;
	// The blob OID of the file's *old* (pre-diff) side: HEAD for the working
	// tree, the merge-base for a branch/PR. Together with contentSig it identifies
	// the whole diff, so a "seen" mark can carry across contexts that show the
	// same change against different bases. Undefined when there is no old side (an
	// added/untracked file) or git couldn't supply one.
	baseContentSig?: string;
}

export interface DiffData {
	file: ChangedFile;
	patch: string;
	oldContents: string;
	newContents: string;
	truncated: boolean;
	// For image files (raster or SVG): `data:` URLs of the old/new bytes, used to
	// render the two versions side by side. Undefined when the file isn't an
	// image, the side doesn't exist (added has no old, deleted has no new), or
	// the bytes exceeded the image size cap. Raster images carry these *instead*
	// of `oldContents`/`newContents` (which would be useless binary); SVGs carry
	// both so they can also show a source diff.
	oldImage?: string;
	newImage?: string;
}

export interface PRSummary {
	number: number;
	title: string;
	body: string;
	author: string;
	authorAvatarUrl: string;
	// The PR author's relationship to the repo (Owner/Member/Contributor/…), shown
	// as a small badge on the Conversation tab's description card.
	authorAssociation?: GithubAuthorAssociation;
	headRef: string;
	baseRef: string;
	headSha: string;
	baseSha: string;
	url: string;
	draft: boolean;
	updatedAt: string;
	state: 'open' | 'closed';
	// When the PR was opened (ISO 8601). Drives the "opened …" line on the
	// Conversation tab's description card.
	createdAt: string;
	// True when the PR has been merged. `state` is "closed" for both merged and
	// plain-closed PRs, so this distinguishes the two for the status icon.
	merged: boolean;
	// The repo the PR's head branch lives in — the contributor's fork for a
	// cross-repo PR, or the base repo for a same-repo PR. Used to set up branch
	// tracking on checkout so commits push back to the PR. Both undefined when
	// the head repo has been deleted.
	headRepoCloneUrl?: string;
	headRepoOwner?: string;
	headRepoName?: string;
	// Whether the PR opts into "allow edits from maintainers". Combined with the
	// viewer's push access to the base repo, this determines whether the viewer
	// can push commits to the PR branch. Undefined when the listing endpoint
	// didn't include it (resolved lazily server-side when needed).
	maintainerCanModify?: boolean;
	// The repo that hosts the PR itself (its base repo) — where its comments,
	// reviews and checks live. For an upstream PR this is the parent repo, not
	// the fork, so PR operations must target it rather than the active repo.
	repoOwner?: string;
	repoName?: string;
	// GitHub's mergeability for the PR, from the single-PR endpoint only — the
	// list endpoint omits these, so both are undefined for PRs we've only listed.
	// `mergeable` is null while GitHub is still computing the answer. Drives the
	// Conversation tab's merge box "conflicts" row.
	mergeable?: boolean | null;
	// Raw merge state: 'clean' | 'dirty' | 'blocked' | 'behind' | 'unstable' |
	// 'unknown' | 'draft' | 'has_hooks'. 'dirty' means the branch conflicts with
	// its base.
	mergeableState?: string;
}

// How GitHub should combine the PR's commits when merging from the merge box.
export type PRMergeMethod = 'merge' | 'squash' | 'rebase';

// Result of a merge attempt. `merged` is false when GitHub declined (e.g. the
// branch became unmergeable between the page render and the click); `message`
// carries GitHub's explanation for the toast.
export interface PRMergeResult {
	merged: boolean;
	message: string;
	sha?: string;
}

// Aggregated CI/workflow status for a PR's head commit. Mirrors GitHub's
// combined-status precedence: any failure wins, then any still-running run,
// else success. 'none' means nothing reported any checks.
export type PRChecksState = 'success' | 'failure' | 'pending' | 'none';

// A single check-run or commit status reported against the head commit.
export interface PRCheck {
	name: string;
	// Per-check rollup. 'none' is never used here — a check is always one of the
	// other three.
	state: PRChecksState;
	// Wall-clock run time in milliseconds, or null when still running or when the
	// source (legacy commit statuses) doesn't expose timing.
	durationMs: number | null;
	// Avatar of the app/integration that reported the check (e.g. GitHub
	// Actions), or null when unavailable.
	avatarUrl: string | null;
	// Link to the check's own page on GitHub — the workflow-run/job for a
	// check-run, or the status's target URL for a legacy commit status. null when
	// the source didn't provide one (the row then isn't clickable).
	url: string | null;
}

// A deployment created against the PR's head commit (e.g. a preview or
// production environment). Surfaced so the checks menu can offer a link to the
// live deployment.
export interface PRDeployment {
	// Environment name, e.g. "production", "preview", "Preview – my-app".
	environment: string;
	// Latest deployment status, mapped onto the same vocabulary as checks so the
	// menu can reuse its status icons ('success' = active, 'failure' = error,
	// 'pending' = in progress). null when no status has been reported yet.
	state: PRChecksState | null;
	// URL to view the deployment — the live environment URL when available, else
	// the deploy log. Always set; deployments without any URL are omitted.
	url: string;
	// Avatar of the GitHub App that created the deployment, which doubles as the
	// hosting provider's logo (e.g. the Vercel/Netlify/Cloudflare Pages bot
	// avatar). null when the creator has no avatar.
	avatarUrl: string | null;
}

// Aggregate state plus the individual checks behind it, for a hover breakdown.
export interface PRChecksSummary {
	state: PRChecksState;
	checks: PRCheck[];
	// Deployments attached to the head commit, deduped to the latest per
	// environment. Empty when nothing was deployed.
	deployments: PRDeployment[];
}

export type DiffContext =
	| { kind: 'branch'; base: string; head: string }
	| { kind: 'workingTree' }
	| { kind: 'pr'; prNumber: number }
	// A frozen snapshot of changes documented by a coding agent. Files don't come
	// from git — they're read back from the session manifest. `ref` reads the
	// manifest committed on a branch/PR viewed read-only (so a reviewer sees that
	// branch's sessions without checking it out); omitted reads the working tree.
	| { kind: 'session'; sessionId: string; ref?: string }
	// A managed stash entry, addressed by its resolved commit SHA (`ref`). The
	// stash commit's parents back the diff: `^1` HEAD parent, `^2` index, `^3`
	// untracked tree. Index-shift-proof because we always resolve to a SHA.
	| { kind: 'stash'; ref: string }
	// A single commit viewed from the History tab, addressed by its SHA (`ref`).
	// The diff is the commit against its first parent (`<ref>^..<ref>`); a root
	// commit with no parent diffs against the empty tree. Shares the branch
	// machinery — `ref` resolves to a base/head pair in refsForContext.
	| { kind: 'commit'; ref: string };

// A workspace package changesets can version. `dir` is the repo-relative posix
// path to the package; `private` packages are still releasable by default
// (changesets versions them) but flagged so the UI can hint at it.
export interface WorkspacePackage {
	name: string;
	dir: string;
	private: boolean;
}

// Snapshot of the repo's changeset situation for the current branch.
export interface ChangesetStatus {
	// `.changeset/config.json` exists — the repo uses changesets.
	installed: boolean;
	// Releasable workspace packages (selectable in the create dialog).
	packages: WorkspacePackage[];
	// Package names with changes on this branch (vs the base merge-base).
	changedPackages: string[];
	// Package names covered by a changeset *introduced on this branch* — changesets
	// already on the base branch (for unrelated, unreleased work) don't count.
	coveredPackages: string[];
	// installed && some changed package isn't covered yet.
	needsChangeset: boolean;
	// Changesets touched on this branch (file path + the packages each bumps).
	// `added` is true when the changeset is new on this branch, false when it was
	// already here and only edited. Lets the UI flag the ones that look unnecessary
	// — a *newly added* changeset whose package has no actual change — and offer to
	// remove them, without nagging about edits to pre-existing changesets.
	branchChangesets: { path: string; packages: string[]; added: boolean }[];
}

// How much a changeset bumps a package.
export type ChangesetBump = 'patch' | 'minor' | 'major';

// Input for writing a new changeset: one bump type applied to every selected
// package, plus a markdown description that becomes the file body.
export interface CreateChangesetInput {
	packages: string[];
	bump: ChangesetBump;
	description: string;
	// Optional filename slug (no extension); used as `.changeset/<name>.md` when it
	// is a safe slug and not already taken, else a random one is generated. Lets the
	// UI preview the exact file it's about to write.
	name?: string;
}

// A changeset file an agent wrote, read back off disk after its run. The agent
// writes the files itself (it has the whole repo to look at, and one file per
// distinct change is its call), so this is what we found, not what it promised.
export interface GeneratedChangesetFile {
	// Repo-relative path, e.g. `.changeset/brave-otters-jog.md`.
	path: string;
	// Packages its frontmatter bumps.
	packages: string[];
	// First line of the body, for reporting what landed.
	summary: string;
}

// What the renderer sends when the user clicks the sparkle on the "Add a
// changeset?" notice. No diff rides along: a changeset describes the whole
// branch, and the agent explores it with its own tools.
export interface GenerateChangesetRequest {
	branch: string | null;
	// Preferred harness from prefs; main process falls back if missing/uninstalled.
	preferredHarness?: CommitMessageHarness | null;
	// Editable base instructions (style only). Empty/omitted uses the default.
	basePrompt?: string | null;
	// Model id for the chosen harness. Empty/omitted uses that harness's default.
	model?: string | null;
}

export interface GenerateChangesetResult {
	ok: boolean;
	harness?: CommitMessageHarness;
	// The changeset files the run added or rewrote. Present only on success.
	written?: GeneratedChangesetFile[];
	// Packages the written changesets reference that this workspace doesn't
	// release — `changeset version` would fail on them, so the UI warns.
	unknownPackages?: string[];
	// Files outside `.changeset/` the run touched despite being told not to.
	// Nothing is reverted; the user is told so they can look.
	strayPaths?: string[];
	error?: string;
	code?: 'no-harness' | 'not-installed' | 'auth' | 'timeout' | 'failed' | 'empty' | 'cancelled';
}

// Progress while an agent works on a branch's changesets. Unlike commit-message
// generation there is no answer to stream — the output is files on disk — so the
// only channel is a short line about what the agent is doing right now
// ("Reading store.svelte.ts", "Running git diff"), for the shimmering notice.
export interface ChangesetProgressEvent {
	status: string;
}

// Which coding-agent harness produced a session. Drives the logo shown on the
// session card; "other" falls back to a generic icon + `harnessLabel`.
export type HarnessKind = 'claude-code' | 'cursor' | 'codex' | 'opencode' | 'copilot' | 'other';

// Harnesses that can generate commit messages via a local CLI. Same set as the
// big coding agents we detect for install, minus freeform `other`.
export type CommitMessageHarness = Exclude<HarnessKind, 'other'>;

// Fixed detection / fallback order when the user hasn't picked a preferred
// harness (or their pick isn't installed).
export const COMMIT_MESSAGE_HARNESS_PRIORITY: readonly CommitMessageHarness[] = [
	'cursor',
	'claude-code',
	'codex',
	'copilot',
	'opencode'
] as const;

// Human display labels for each harness. The matching logos live in the UI's
// HarnessLogo component; this map is the browser-safe source of truth for the
// names (used by the CLI's PR attribution footers and the renderer alike).
const HARNESS_LABELS: Record<HarnessKind, string> = {
	'claude-code': 'Claude Code',
	cursor: 'Cursor',
	codex: 'Codex',
	opencode: 'OpenCode',
	copilot: 'GitHub Copilot',
	other: 'Agent'
};

// The display label for a harness. `other` has no fixed name, so it falls back
// to a caller-supplied label (e.g. a session's freeform `harnessLabel`), then to
// the generic "Agent".
export function harnessLabel(harness: HarnessKind, fallback?: string): string {
	if (harness === 'other') return fallback?.trim() || HARNESS_LABELS.other;
	return HARNESS_LABELS[harness];
}

// How a user signs a harness CLI back in. Every one of these is a terminal
// command; none of them can be driven from inside this app, so the recovery
// affordance we offer is "here is the exact command, copied, in a terminal
// already sitting in your repo". `interactive` marks the ones that drop you
// into a TUI where the real step is a slash command typed at the prompt —
// those need the extra `then` line or the instruction is incomplete.
export interface HarnessLoginRecipe {
	// The command to run. Copied verbatim by the recovery button.
	command: string;
	// A follow-up typed inside the CLI once it starts, for interactive harnesses.
	then?: string;
}

const HARNESS_LOGIN: Record<CommitMessageHarness, HarnessLoginRecipe> = {
	'claude-code': { command: 'claude', then: '/login' },
	cursor: { command: 'cursor-agent login' },
	codex: { command: 'codex login' },
	copilot: { command: 'copilot', then: '/login' },
	opencode: { command: 'opencode auth login' }
};

export function harnessLoginRecipe(harness: CommitMessageHarness): HarnessLoginRecipe {
	return HARNESS_LOGIN[harness];
}

// One-line instruction for signing a harness back in, for prose (toast bodies,
// settings rows). The copy button uses `harnessLoginRecipe().command` on its
// own, so this stays human-readable rather than paste-ready.
export function harnessLoginHint(harness: CommitMessageHarness): string {
	const recipe = HARNESS_LOGIN[harness];
	return recipe.then
		? `run \`${recipe.command}\`, then \`${recipe.then}\``
		: `run \`${recipe.command}\``;
}

// A single changed file frozen into a session: the diff metadata plus the
// captured patch and file contents, so the session renders without touching
// git. Contents are "" for added/deleted/binary/truncated sides, matching the
// conventions of `DiffData`.
export interface SessionFile {
	path: string;
	oldPath?: string;
	status: FileStatus;
	additions: number;
	deletions: number;
	isBinary: boolean;
	patch: string;
	oldContents: string;
	newContents: string;
	truncated: boolean;
	// Frozen `data:` URLs for image files, mirroring DiffData. Undefined for
	// non-image files or sides that don't exist. Captured so a session's image
	// diffs render without touching git.
	oldImage?: string;
	newImage?: string;
}

// Listing-level view of a session — everything but the (potentially large)
// per-file contents, so the Sessions tab can render the list cheaply.
export interface SessionSummary {
	id: string;
	repoId: string;
	// The harness's own conversation/run id. Used by the CLI to upsert: the same
	// key re-captures (updates) the existing session instead of creating a new
	// one. Undefined for sessions created without a key.
	key?: string;
	name: string;
	description: string;
	// A short, conventional-commit-style title the agent suggests for committing
	// these changes (e.g. "feat: reply to local review comments"). Surfaced by the
	// desktop app to pre-fill the commit box, the same way a changeset does.
	// Undefined for sessions saved without one.
	commitTitle?: string;
	// Repo-relative paths of the files this session captured. Derived for the
	// summary (the full Session carries them on `files`) so the app can tell
	// whether a session still describes the current working-tree changes without
	// reading the whole manifest.
	paths: string[];
	harness: HarnessKind;
	// Freeform harness name shown when `harness === "other"`.
	harnessLabel?: string;
	// Optional deep link back to the agent run (resume/permalink). When present
	// the card shows an "open in harness" button.
	harnessUrl?: string;
	// Branch the snapshot was taken on, and the commit it was diffed against.
	branch?: string;
	baseRef?: string;
	createdAt: number;
	// Bumped on every re-capture so the list can sort by most-recently-updated.
	updatedAt: number;
	fileCount: number;
	additions: number;
	deletions: number;
	// Number of tour steps. 0 for a flat session saved without a tour, which
	// renders as a plain file list.
	stepCount: number;
}

// A callout pins commentary to a specific line range within a file's diff, so
// the agent can say "look right here" instead of describing it in prose. The
// range is 1-based inclusive on the given side of the frozen diff, so it never
// drifts. `body` is Markdown.
export interface SessionCallout {
	// Stable id within the session, assigned at capture.
	id: string;
	// The file this callout sits in (one of its step's files).
	file: string;
	startLine: number;
	endLine: number;
	// Which side the line numbers refer to: "new" = additions (the new file),
	// "old" = deletions (the original).
	side: 'new' | 'old';
	body: string;
}

// One stop on a session's guided tour: a titled, explained group of related
// changed files, so the reviewer reads the change as a narrative instead of an
// alphabetical pile of diffs. `body` is Markdown commentary; `paths` reference
// files in the session's `files`, in the order the agent wants them read.
// `callouts` optionally pin finer-grained notes to line ranges within them.
export interface SessionStep {
	// Stable id within the session, assigned at capture.
	id: string;
	title: string;
	body: string;
	paths: string[];
	callouts: SessionCallout[];
}

// A full session: its summary, the guided tour, and the frozen per-file diffs.
// `paths` is omitted here — it's a summary-only convenience derived from `files`,
// so it's not duplicated in the (already large) stored manifest.
export interface Session extends Omit<SessionSummary, 'paths'> {
	files: SessionFile[];
	// Ordered tour steps. Empty when saved without a tour; then `files` is shown
	// as a flat list with no step headers.
	steps: SessionStep[];
}

// A review comment attached to a specific line in a PR diff.
// `side: 'RIGHT'` lives in the head file (additions); `'LEFT'` in the base
// file (deletions) — matches GitHub's REST API.
export interface PRReviewComment {
	id: number;
	prNumber: number;
	path: string;
	body: string;
	bodyHtml?: string;
	author: string;
	authorAvatarUrl: string;
	createdAt: string;
	updatedAt: string;
	url: string;
	// The comment's line in the *current* diff. Null once the anchored line was
	// changed/deleted (or the whole file was removed) — i.e. the comment is
	// outdated. Used to pin the comment inline; outdated comments aren't pinned.
	line: number | null;
	// The line the comment was originally placed on, preserved by GitHub even
	// after the diff moves on. Used to render/label the comment when `line` is
	// null (outdated).
	originalLine: number | null;
	// The comment's position within the current diff hunk, mirroring GitHub's
	// REST `position`. Kept for reference/pinning; note REST leaves this populated
	// (reflecting the original diff position) even after a comment goes outdated,
	// so it is NOT a reliable outdated signal — `line` going null is (see below).
	position: number | null;
	// The stored unified-diff hunk GitHub captured when the comment was made. Lets
	// us render the comment's code context from the snapshot rather than the
	// working tree, so comments on changed/deleted lines (and deleted files) still
	// show their context with no file present.
	diffHunk?: string;
	// Derived: the comment had a line anchor (`originalLine`) that no longer maps
	// into the current diff, so GitHub nulled the live `line`
	// (`line == null && originalLine != null`). Mirrors GitHub's "Outdated" label.
	// Independent of `isResolved` — an outdated comment is not auto-resolved.
	isOutdated: boolean;
	side: 'LEFT' | 'RIGHT';
	// Top-level comment id this one is replying to (if any).
	inReplyTo?: number;
	// The viewer's permission to delete: true when this comment was authored
	// by the active GitHub account.
	canDelete: boolean;
	// GraphQL node id of the review thread this comment belongs to. Needed to
	// resolve/unresolve the thread (the REST API can't). Undefined when the
	// thread couldn't be resolved (e.g. GraphQL lookup failed, or a comment we
	// just created locally that hasn't been refetched yet).
	threadId?: string;
	// Whether the comment's review thread is resolved on GitHub. Sourced from
	// GraphQL — the REST review-comment payload doesn't expose it — so it
	// defaults to false when the thread lookup is unavailable.
	isResolved: boolean;
	// True while this is a locally-created placeholder shown optimistically the
	// instant the user hits submit, before the GitHub round-trip returns. It
	// carries a temporary negative `id` (and no `url`/`threadId` yet). This is
	// internal bookkeeping only: it renders identically to a real comment, and the
	// store uses the flag purely to find this entry and reconcile it to the server
	// comment on success (or roll it back on failure), and to carry it through a
	// background refresh. Never set on a server-sourced comment.
	optimistic?: boolean;
}

export interface NewReviewCommentInput {
	prNumber: number;
	path: string;
	body: string;
	line: number;
	side: 'LEFT' | 'RIGHT';
	// Git ref of the commit the on-screen diff was rendered from, so the comment
	// anchors to exactly what the user is looking at. `pr/<n>/head` for a PR view,
	// or the branch tip for a Branch view. On the Branch tab the branch tip (once
	// pushed) IS the PR's live head, so the comment isn't born "Outdated" — unlike
	// anchoring to a `pr/<n>/head` snapshot that lags commits pushed since the PR
	// was last fetched. Omitted for views with no committed head (e.g. working
	// tree), where the main process falls back to `pr/<n>/head` then the live head.
	headRef?: string;
}

// ─── PR conversation timeline ─────────────────────────────────────────────────
// The PR's top-level conversation — what GitHub shows on the "Conversation" tab —
// as a single chronologically-ordered feed. Distinct from the line-anchored
// review comments in `PRReviewComment[]`: these are the issue comments, review
// summaries, commits and timeline events that make up the discussion around the
// PR as a whole. A discriminated union so the renderer can render each kind with
// its own chrome.
export type PRConversationItem =
	| PRConversationComment
	| PRConversationReview
	| PRConversationCommit
	| PRConversationEvent
	| PRConversationReference;

interface PRConversationBase {
	// Stable, unique key for the renderer's keyed `{#each}`.
	key: string;
	// ISO 8601 timestamp the feed is ordered by.
	createdAt: string;
}

// The commenter's relationship to the repo, as GitHub reports it
// (`author_association`). Drives the small "Owner"/"Member"/"Contributor" badge
// next to a name. 'NONE' (and anything we don't badge) renders nothing.
export type GithubAuthorAssociation =
	| 'OWNER'
	| 'MEMBER'
	| 'COLLABORATOR'
	| 'CONTRIBUTOR'
	| 'FIRST_TIME_CONTRIBUTOR'
	| 'FIRST_TIMER'
	| 'MANNEQUIN'
	| 'NONE';

// A top-level issue comment posted to the PR conversation.
export interface PRConversationComment extends PRConversationBase {
	kind: 'comment';
	id: number;
	author: string;
	authorAvatarUrl: string;
	authorAssociation?: GithubAuthorAssociation;
	body: string;
	url: string;
	// True when authored by the active GitHub account (so it can be deleted).
	canDelete: boolean;
}

// A submitted review (its summary body + verdict). Inline review comments live in
// `PRReviewComment[]`, not here; an empty-body "commented" review is dropped by
// the service so it doesn't show up as a contentless row.
export interface PRConversationReview extends PRConversationBase {
	kind: 'review';
	id: number;
	author: string;
	authorAvatarUrl: string;
	authorAssociation?: GithubAuthorAssociation;
	body: string;
	state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
	url: string;
}

// A commit pushed to the PR's head branch.
export interface PRConversationCommit extends PRConversationBase {
	kind: 'commit';
	sha: string;
	shortSha: string;
	// First line of the commit message (the subject).
	message: string;
	// The rest of the commit message (everything after the first line), trimmed.
	// Undefined for a single-line commit. Surfaced behind a "…" toggle, like
	// GitHub's expandable commit description.
	body?: string;
	author: string;
	authorAvatarUrl?: string;
	// True when GitHub verified the commit's signature (renders a "Verified" badge,
	// mirroring GitHub's commit list).
	verified: boolean;
	url?: string;
}

// A lighter-weight timeline event (merged, closed, reopened, labeled, renamed,
// review requested, …) rendered as a one-line activity entry. `event` is the raw
// GitHub event name; `detail` carries any supplemental text (a label name, the
// new title for a rename, the requested reviewer).
export interface PRConversationEvent extends PRConversationBase {
	kind: 'event';
	event: string;
	actor: string;
	actorAvatarUrl?: string;
	detail?: string;
	// For a `renamed` event: the previous title (GitHub's `rename.from`). `detail`
	// carries the new title, so the row can show the old title struck through, like
	// GitHub.
	renamedFrom?: string;
	// For label events: the label's hex color (no leading '#'), so it renders as a
	// colored chip like GitHub rather than plain text.
	labelColor?: string;
	// True for a Copilot `review_requested` that GitHub auto-created from a repo's
	// "automatically request Copilot review" setting (inferred from the request
	// landing within seconds of the PR opening / being marked ready). GitHub shows
	// these as "Copilot review requested due to automatic review settings" with the
	// reviewer (not the triggering user) as the subject.
	auto?: boolean;
	// For the `merged` event: the short SHA of the merge commit, so the row can
	// read "merged commit <sha> into <base>" like GitHub. Undefined otherwise.
	commitSha?: string;
	// For the `merged` event: a link to the merge commit on GitHub, opened when the
	// SHA is clicked.
	commitUrl?: string;
}

// A cross-reference: another issue or PR that mentioned this one (GitHub's
// `cross-referenced` timeline event, rendered as "X mentioned this pull request"
// with a link to the referencing item and its status badge).
export interface PRConversationReference extends PRConversationBase {
	kind: 'reference';
	actor: string;
	actorAvatarUrl?: string;
	// The referencing issue/PR.
	refNumber: number;
	refTitle: string;
	refUrl: string;
	// True when the referencing item is a PR (vs a plain issue) — drives the icon
	// and the "pull request" / "issue" wording.
	isPullRequest: boolean;
	// Status of the referencing item, for the trailing badge.
	refState: 'open' | 'closed' | 'merged' | 'draft';
}

// ─── Local review comments ───────────────────────────────────────────────────
// A reviewer's note pinned to a line range of a diff, stored locally in the repo
// under .super-review/comments (one JSON file per comment) so it travels with the
// branch like a session. Unlike PRReviewComment these never touch GitHub: they're
// a human's working-tree review notes that an agent can read back, act on, and
// mark resolved — optionally linking the session that documents the fix. Comments
// thread one level deep: a reply carries `inReplyTo` pointing at the root (see
// LocalComment).

// Who authored or resolved a local comment. Humans leave comments in the desktop
// app; agents (claude-code, cursor, …) resolve them and can reply to a thread (via
// the CLI), so an agent can appear as an `author` on a reply as well as a
// `resolvedBy`. `harness` is set for agents so the UI can show their logo,
// mirroring how sessions identify their harness.
export interface LocalCommentAuthor {
	kind: 'human' | 'agent';
	// Display name: a human's git/GitHub handle, or an agent's harness label.
	name: string;
	// The agent's harness, when kind === 'agent'. Drives the logo shown beside the
	// resolver, matching how a session card shows its harness.
	harness?: HarnessKind;
	// The human author's GitHub avatar, when signed in. Lets the app show the same
	// avatar next to a local comment as it does for PR review comments. Absent for
	// agents (they show their harness logo) and for anonymous "You" comments.
	avatarUrl?: string;
}

// A single local comment. Anchored GitHub-style by `side` + line range, so it
// never drifts within a frozen ref but may go "outdated" if the working tree
// changes under it (the UI keeps it, just unanchored).
export interface LocalComment {
	id: string;
	// Which diff view this comment was made in — `diffContextKey(ctx)` (e.g.
	// "workingTree", "branch:main..feat", "pr:12", "session:<id>", "stash:<sha>").
	// Comments are scoped per view: a comment only surfaces in the context it was
	// authored in.
	contextKey: string;
	// File the comment is pinned to, repo-relative (posix), matching SessionFile.
	path: string;
	// Which side the line numbers refer to, matching PRReviewComment: 'RIGHT' = the
	// new file (additions), 'LEFT' = the original (deletions).
	side: 'LEFT' | 'RIGHT';
	// 1-based inclusive line range on `side`. A single-line comment has
	// startLine === endLine.
	startLine: number;
	endLine: number;
	// The note itself (Markdown).
	body: string;
	author: LocalCommentAuthor;
	createdAt: number;
	updatedAt: number;
	// Top-level comment id this one replies to, if any — the thread root. A reply
	// inherits its root's anchor (path/side/line range) and contextKey so it stacks
	// under the root in the diff. Replies are always one level deep (they point at
	// the root, never another reply), mirroring how PR review threads flatten.
	// Resolution stays a thread-level concept carried by the root, so replies don't
	// get their own resolution.
	inReplyTo?: string;
	// Resolution. Presence of `resolvedAt` ⇒ resolved. An agent that fixed the
	// feedback can link the session documenting the fix via `resolvedSessionId`, so
	// the reviewer can jump straight to that guided tour.
	resolvedAt?: number;
	resolvedBy?: LocalCommentAuthor;
	resolvedSessionId?: string;
}

// The fields a caller supplies to create a local comment; the store fills in the
// id and timestamps.
export interface NewLocalCommentInput {
	contextKey: string;
	path: string;
	side: 'LEFT' | 'RIGHT';
	startLine: number;
	endLine: number;
	body: string;
	author: LocalCommentAuthor;
	// Set when this comment is a reply — the thread root's id. The caller is
	// responsible for inheriting the root's anchor (path/side/lines) + contextKey.
	inReplyTo?: string;
}

// ─── Branch task lists ───────────────────────────────────────────────────────
// A lightweight per-branch checklist for tracking work-in-progress before a PR
// ("add a test", "rename this", "ask about X"). Stored in-repo under
// `.super-review/tasks/<branchSlug>.json` and committed, so a list travels with
// the branch like a session. Managed from the desktop Tasks tab and the
// `super-review task` CLI.

// Who created a task or checked it off. Reuses the local-comment attribution
// shape so the UI can render the same harness logo / avatar: humans act in the
// desktop app; agents (claude-code, cursor, …) act via the CLI and carry a
// `harness` so the app shows their logo.
export type TaskActor = LocalCommentAuthor;

// A single task on a branch's list.
export interface Task {
	id: string;
	// The task text (single line).
	title: string;
	// Optional longer notes / description (Markdown).
	notes?: string;
	// The parent task's id when this is a subtask; absent for a top-level task.
	// Subtasks nest arbitrarily deep (a subtask can itself have children).
	parentId?: string;
	// On hold: the task is upcoming but not ready to be worked on yet. Purely a
	// display state (dimmed in the UI); distinct from `done` and carries no
	// attribution. Absent/false means active.
	onHold?: boolean;
	// Checked-off state.
	done: boolean;
	// Sort position within the list; new tasks append to the end. Subtasks sort
	// among their siblings under the parent.
	order: number;
	createdAt: number;
	updatedAt: number;
	// Who added the task.
	createdBy: TaskActor;
	// Who checked it off, and when — set when `done` flips to true, cleared when it
	// flips back to false. The UI shows this actor's logo/avatar beside a done task.
	doneBy?: TaskActor;
	doneAt?: number;
}

// The on-disk file for one branch's tasks. One file per branch.
export interface TaskList {
	// The branch these tasks belong to (the real name; the filename is a slug of it).
	branch: string;
	tasks: Task[];
	updatedAt: number;
}

// The fields a caller supplies to create a task; the store fills in the id,
// order, timestamps, and `createdBy`.
export interface NewTaskInput {
	title: string;
	notes?: string;
	// Set to make this a subtask of an existing task (its id).
	parentId?: string;
	actor: TaskActor;
}

// The fields a caller may patch on an existing task. The done state and its
// attribution go through a dedicated setter; hold is a plain flag with no
// attribution, so it rides along here.
export interface TaskPatch {
	title?: string;
	notes?: string;
	order?: number;
	onHold?: boolean;
}

export type ViewMode = 'split' | 'unified';

// How the diff view lays out a context's files. 'scroll' renders every file's
// diff in one long scrollable list; 'single' shows one file's diff at a time
// (GitHub Desktop-style), switching as the user picks files in the sidebar.
export type DiffLayout = 'scroll' | 'single';

// How the sidebar file list is laid out. 'tree' groups files into nested
// folders (VSCode-style); 'list' flattens to one file per row.
export type FileListLayout = 'tree' | 'list';

// What to do when a checked-out branch's PR is observed merging. 'prompt' asks
// via a dialog (default); 'switch' switches back to the default branch
// automatically; 'nothing' leaves the working tree where it is and never asks.
export type PrMergedBehavior = 'prompt' | 'switch' | 'nothing';

// How much UI motion the user wants:
//  • 'none':    no animation anywhere.
//  • 'accents': accent-level motion only (hover/focus transitions, counter
//    tweens, the review-complete celebration), but overlay surfaces (menus,
//    dialogs, tooltips, popovers, sheets) appear instantly.
//  • 'all':     everything, including those overlay surfaces.
// Consumed via the useAnimations() context hook.
export type AnimationMode = 'none' | 'accents' | 'all';

// Which tab in the file list drives `DiffContext`. Persisted so the app
// restores the last tab on launch.
export type ContextTab = 'unstaged' | 'branch' | 'sessions' | 'history';

// Which GitHub repo a PR listing/checkout targets: the repo's own remote
// ("fork") or, when the repo is a fork, its parent ("upstream").
export type PRSource = 'fork' | 'upstream';

export type EditorKind = 'cursor' | 'vscode' | 'zed' | 'xcode' | 'visualstudio';

export type TerminalKind = 'terminal' | 'iterm' | 'warp' | 'ghostty' | 'cmd' | 'powershell';

export type AppPlatform = 'darwin' | 'win32' | 'linux';

// Actions a file row's native context menu can return. `null` (from the IPC)
// means the menu was dismissed without a choice. The `*Selected` variants act
// on the sidebar's whole multi-selection (cmd/shift-click) rather than the
// single right-clicked file.
export type FileContextMenuAction =
	| 'discard'
	| 'discardSelected'
	| 'includeSelected'
	| 'excludeSelected'
	// Seen marks apply to the menu's whole target set: the multi-selection when
	// the menu was opened on one, else just the right-clicked file. Both cases
	// share these two actions, so the names carry no "Selected".
	| 'markSeen'
	| 'markUnseen'
	// Any of the add-to-.gitignore items (file / folder / extension / selection).
	// They differ only in which patterns they append, so they share one action and
	// the result carries the chosen patterns.
	| 'ignore'
	| 'copyPath'
	| 'copyRelativePath'
	| 'reveal'
	| 'openInEditor'
	| 'openDefault';

// What the file context menu resolves to. `null` (from the IPC) means dismissed.
// Every action but `ignore` is fully described by its name; `ignore` also carries
// the exact .gitignore patterns the chosen item appends, since one action backs
// several items (this file, an ancestor folder, an extension, the selection).
export type FileContextMenuResult =
	| { action: Exclude<FileContextMenuAction, 'ignore'> }
	| { action: 'ignore'; patterns: string[] };

// Action the staging gutter's native discard menu can return. `null` (from the
// IPC) means the menu was dismissed; `discard` confirms the discard. The renderer
// already knows which lines it targeted, so a single confirm action suffices.
export type DiffLineContextMenuAction = 'discard';

// What the renderer hands the main process to build the discard menu. The scope
// drives the single item's wording: `line` for an inner (per-line) button,
// `lines` for an outer (hunk/section) button.
export interface DiffLineContextMenuParams {
	scope: 'line' | 'lines';
}

// Actions a branch row's native context menu can return. `null` (from the
// IPC) means the menu was dismissed without a choice.
export type BranchContextMenuAction = 'copy' | 'delete' | 'view';

// Actions a pull-request row's native context menu can return. `view` opens the
// PR's diff read-only (no checkout). `null` (from the IPC) means dismissed.
export type PRContextMenuAction = 'view' | 'copyUrl' | 'openOnGitHub';

// What a task row's native context menu was opened on, so the menu can label the
// check-off and hold items to match the current state and gate "Add Subtask" on
// whether the row can take another level of children.
export interface TaskContextMenuParams {
	done: boolean;
	onHold: boolean;
	canAddSubtask: boolean;
}

// Actions a task row's native context menu can return. `toggle` flips the done
// state; `hold` flips the on-hold state; `addSubtask` starts a child task; `null`
// (from the IPC) means dismissed.
export type TaskContextMenuAction = 'toggle' | 'hold' | 'addSubtask' | 'edit' | 'delete';

// Actions a repo row's native context menu can return. `null` (from the IPC)
// means the menu was dismissed without a choice.
export type RepoContextMenuAction = 'copyPath' | 'reveal' | 'remove' | 'settings';

// Actions a commit row's native context menu can return. `null` (from the IPC)
// means the menu was dismissed without a choice.
export type CommitContextMenuAction = 'copyShortHash' | 'copyFullHash';

// A single toggle in the header's "Show in header" native context menu. `key`
// is the HeaderItemVisibility field it controls; `checked` is its current state.
export interface HeaderContextMenuItem {
	key: keyof HeaderItemVisibility;
	label: string;
	checked: boolean;
}

// Params for the header's native context menu: the toggle items to show, in
// order, each carrying its current checked state.
export interface HeaderContextMenuParams {
	items: HeaderContextMenuItem[];
}

// What the header context menu returns: the toggled item's key and its new
// checked state. `null` (from the IPC) means the menu was dismissed.
export type HeaderContextMenuResult = {
	key: keyof HeaderItemVisibility;
	checked: boolean;
} | null;

// Role-menu / window-chrome actions the Windows HTML AppMenuBar can invoke.
// Electron still owns the same actions via Menu.setApplicationMenu accelerators;
// these cover clicks on the in-renderer Menubar.
export type WindowChromeAction =
	| 'undo'
	| 'redo'
	| 'cut'
	| 'copy'
	| 'paste'
	| 'selectAll'
	| 'reload'
	| 'forceReload'
	| 'toggleDevTools'
	| 'resetZoom'
	| 'zoomIn'
	| 'zoomOut'
	| 'toggleFullscreen'
	| 'minimize'
	| 'maximize'
	| 'close'
	| 'quit';

// A single toggle in the empty view's right-click native context menu. `key` is
// the EmptyViewItemVisibility field it controls; `checked` is its current state.
export interface EmptyViewContextMenuItem {
	key: keyof EmptyViewItemVisibility;
	label: string;
	checked: boolean;
}

// Params for the empty view's native context menu: the toggle items to show.
export interface EmptyViewContextMenuParams {
	items: EmptyViewContextMenuItem[];
}

// What the empty view context menu returns: the toggled item's key and its new
// checked state. `null` (from the IPC) means the menu was dismissed.
export type EmptyViewContextMenuResult = {
	key: keyof EmptyViewItemVisibility;
	checked: boolean;
} | null;

// A single toggle in a diff file header's "Show in file header" native context
// menu. `key` is the FileHeaderItemVisibility field it controls; `checked` is
// its current state.
export interface FileHeaderContextMenuItem {
	key: keyof FileHeaderItemVisibility;
	label: string;
	checked: boolean;
}

// Params for a file header's native context menu: the toggle items to show, in
// order, each carrying its current checked state.
export interface FileHeaderContextMenuParams {
	items: FileHeaderContextMenuItem[];
}

// What the file header context menu returns: the toggled item's key and its new
// checked state. `null` (from the IPC) means the menu was dismissed.
export type FileHeaderContextMenuResult = {
	key: keyof FileHeaderItemVisibility;
	checked: boolean;
} | null;

// A single toggle in the sidebar tab strip's "Show tab" native context menu.
// `key` is the SidebarTabVisibility field it controls; `checked` is its state.
export interface TabsContextMenuItem {
	key: keyof SidebarTabVisibility;
	label: string;
	checked: boolean;
}

// Params for the tab strip's native context menu: the toggle items to show, in
// order, each carrying its current checked state.
export interface TabsContextMenuParams {
	items: TabsContextMenuItem[];
}

// What the tab strip context menu returns: the toggled tab's key and its new
// checked state. `null` (from the IPC) means the menu was dismissed.
export type TabsContextMenuResult = {
	key: keyof SidebarTabVisibility;
	checked: boolean;
} | null;

// A single toggle in the sidebar controls row's "Show button" native context
// menu. `key` is the SidebarControlVisibility field it controls; `checked` is
// its current state.
export interface SidebarControlsContextMenuItem {
	key: keyof SidebarControlVisibility;
	label: string;
	checked: boolean;
}

// Params for the controls row's native context menu: the toggle items to show,
// in order, each carrying its current checked state.
export interface SidebarControlsContextMenuParams {
	items: SidebarControlsContextMenuItem[];
}

// What the controls row context menu returns: the toggled button's key and its
// new checked state. `null` (from the IPC) means the menu was dismissed.
export type SidebarControlsContextMenuResult = {
	key: keyof SidebarControlVisibility;
	checked: boolean;
} | null;

// Items in the native application menu's "Branch" submenu. The main process
// sends the chosen action to the focused renderer, which runs the matching
// store flow (some open a confirm dialog first).
export type BranchMenuAction =
	| 'newBranch'
	| 'updateFromDefault'
	| 'updateFromUpstream'
	| 'deleteBranch'
	| 'discardAll'
	| 'previewPR'
	| 'createPR';

// Renderer-computed state that decides which "Branch" menu items are enabled
// and what their dynamic labels read. Pushed to the main process whenever it
// changes so the native menu greys out inapplicable items (e.g. "Delete
// Branch" on the default branch), like GitHub Desktop.
export interface BranchMenuState {
	hasRepo: boolean;
	// The repo's default branch name, woven into the "Update from <x>" label.
	defaultBranch: string;
	onDefaultBranch: boolean;
	hasChanges: boolean;
	hasGithub: boolean;
	// True when the repo is a fork with a known parent — enables "Update from
	// upstream/<default>".
	hasUpstream: boolean;
	// The open PR for the current branch, if any — flips "Create" to "View".
	branchPRNumber: number | null;
}

// Items in the native application menu's "Repository" submenu. Mirrors GitHub
// Desktop's Repository menu; the main process sends the chosen action to the
// focused renderer, which runs the matching store flow.
export type RepositoryMenuAction =
	| 'push'
	| 'pull'
	| 'fetch'
	| 'remove'
	| 'viewOnGithub'
	| 'openInTerminal'
	| 'showInFinder'
	| 'openInEditor'
	| 'createIssue'
	| 'cleanupBranches'
	| 'settings';

// Items in the native application menu's "Help" submenu. The main process sends
// the chosen action to the focused renderer, which runs the matching store flow.
export type HelpMenuAction = 'sendFeedback';

// How the user classified their feedback, so it can be routed on arrival.
export type FeedbackCategory = 'bug' | 'idea' | 'other';

// What the feedback dialog hands the main process to send to the Super Review
// backend.
export interface FeedbackInput {
	category: FeedbackCategory;
	// One-line summary.
	title: string;
	// Free-form details. App version and OS are attached in the main process so
	// the renderer can't spoof them.
	body: string;
	// Optional reply-to address. The only way to follow up with someone who
	// isn't signed in, so it's offered even though most reports won't have one.
	email?: string;
	// What the user was doing, when the report came from an error toast. Sent
	// structured rather than pasted into `body` so triage can read it as fields
	// and the body stays the reporter's own words.
	context?: ErrorContext;
}

// Acknowledgement of a stored submission. `id` is the backend row id — useful
// in a support conversation, but not something the user can browse to.
export interface FeedbackResult {
	id: string;
}

// Best-effort snapshot of what the user was doing when an error fired, so a
// one-click report carries enough detail for an agent to debug it. Captured
// from app state at the moment `setError` runs; `action` is supplied by the
// caller when the failing operation is known.
export interface ErrorContext {
	// What the app was attempting, e.g. "Pushing branch" or "Submitting comment".
	action?: string;
	// Which review tab was active.
	tab?: ContextTab;
	// The repo being reviewed and its checked-out branch.
	repo?: string;
	branch?: string;
	// The active item within the tab (session, commit, or PR), when there is one.
	location?: string;
}

// A single error surfaced to the user as a toast. Errors stack rather than
// overwrite, so a new failure never silently replaces an earlier one; `id`
// keys the stack and lets a single toast be dismissed.
export interface ErrorToast {
	id: string;
	message: string;
	context?: ErrorContext;
	// How many times this same error has fired in a row. Consecutive duplicates
	// collapse into this toast (bumping the count) instead of piling up; the UI
	// shows a "×N" badge once it's > 1.
	count: number;
	// Incremented on every repeat so the UI can re-trigger a shake animation —
	// the cue that a new (identical) error just occurred even though no new toast
	// appeared.
	bump: number;
}

// Pre-filled fields handed to the feedback dialog when it's opened from a
// one-click error report. Every field is optional so the dialog falls back to
// its blank defaults when opened normally.
export interface FeedbackDraft {
	category?: FeedbackCategory;
	title?: string;
	body?: string;
	// Carried through to the submission so the captured context survives as
	// structured data instead of only as prose in the body.
	context?: ErrorContext;
}

// Renderer-computed state deciding which "Repository" menu items are enabled and
// their dynamic labels. Items whose label is null are hidden (no editor/terminal
// detected), matching the rest of the menu's "show what applies" behavior.
export interface RepositoryMenuState {
	hasRepo: boolean;
	// Whether `origin` exists — gates Push/Pull/Fetch.
	hasRemote: boolean;
	// Whether the branch actually has something to push (commits the remote
	// lacks, or no upstream yet). Keeps Push (and its ⌘P accelerator) greyed out
	// on an up-to-date branch instead of running a no-op fetch/push.
	canPush: boolean;
	// Whether the repo has a GitHub remote — gates View on GitHub / Create Issue.
	hasGithub: boolean;
	// "Open in <editor>" / "Open in <terminal>" labels (null → item hidden).
	editorLabel: string | null;
	terminalLabel: string | null;
	// Platform-specific file-manager label, e.g. "Show in Finder".
	revealLabel: string;
}

// What the renderer hands the main process to build a repo row's native menu.
export interface RepoContextMenuParams {
	// The repo's display name — used in the "Remove" item's label.
	name: string;
	// Platform-specific file-manager label, e.g. "Reveal in Finder".
	revealLabel: string;
}

// What the renderer hands the main process to build a branch row's native menu.
export interface BranchContextMenuParams {
	// The branch name — shown back to the user isn't needed here, but kept for
	// parity/labelling if the menu grows.
	name: string;
	// Whether to show "Delete Branch…" — hidden for the currently checked-out
	// branch (which git can't delete anyway).
	canDelete: boolean;
	// Whether to show "View Read-Only" — hidden for the branch already shown in
	// the UI (viewing it would be a no-op / return-home).
	canView: boolean;
}

// What the renderer hands the main process to build a pull-request row's native
// menu.
export interface PRContextMenuParams {
	// The PR number, used to label the menu.
	number: number;
	// Whether to show "View Read-Only" — hidden for the PR already shown in the UI.
	canView: boolean;
}

// What the renderer hands the main process to build a file row's native menu.
// The labels are resolved renderer-side (platform name, configured editor) so
// the main process just renders them.
export interface FileContextMenuParams {
	// Repo-relative path of the file the menu targets — used in the discard
	// confirmation message.
	filePath: string;
	// Whether to show "Discard Changes" (only meaningful for working-tree
	// changes, not committed branch/PR diffs).
	canDiscard: boolean;
	// Label for the "Open in <editor>" item, or null to hide it when no editor
	// is configured/detected.
	editorLabel: string | null;
	// Platform-specific file-manager label, e.g. "Reveal in Finder".
	revealLabel: string;
	// How many files are in the sidebar's current multi-selection. When > 1 the
	// menu leads with bulk actions ("Discard N Files", etc.) that operate on the
	// whole selection instead of just `filePath`.
	selectedCount: number;
	// Whether to offer commit Include/Exclude items — only in the Unstaged tab,
	// where the file list drives which changes go into the next commit.
	canInclude: boolean;
	// Whether the right-clicked file is currently marked seen, so the single-file
	// menu can offer the one item that flips it ("Mark as Unseen" when it is).
	// Ignored for a multi-selection, which offers both directions at once since
	// the files in it can be in either state.
	isSeen: boolean;
	// Ready-made .gitignore patterns for the add-to-.gitignore items. The renderer
	// builds and escapes them (and drops .gitignore itself, which is never worth
	// ignoring); the main process only turns them into labelled menu items. An
	// empty array / null hides the corresponding item.
	//
	// The escaped repo-relative path of the right-clicked file ("Ignore File").
	ignoreFile: string | null;
	// Its ancestor directories, deepest first ("/apps/desktop/src", "/apps/desktop",
	// ...), shown as the "Ignore Folder" submenu.
	ignoreFolders: string[];
	// Distinct extensions across the targeted files, each with its leading dot
	// (".ts"), capped like GitHub Desktop at five. Each becomes an "Ignore All .ts
	// Files" item appending `*.ts`.
	ignoreExtensions: string[];
	// The escaped paths of every ignorable file in a multi-selection, backing the
	// "Ignore N Selected Files" item.
	ignoreSelected: string[];
}

// Which editors/terminals make sense to offer per OS. The Settings UI only
// lists these (e.g. Xcode/iTerm are macOS-only, Visual Studio is Windows-only).
export const EDITORS_BY_PLATFORM: Record<AppPlatform, EditorKind[]> = {
	darwin: ['cursor', 'vscode', 'zed', 'xcode'],
	win32: ['cursor', 'vscode', 'zed', 'visualstudio'],
	linux: ['cursor', 'vscode', 'zed']
};

export const TERMINALS_BY_PLATFORM: Record<AppPlatform, TerminalKind[]> = {
	darwin: ['terminal', 'iterm', 'warp', 'ghostty'],
	win32: ['cmd', 'powershell'],
	linux: []
};

export interface PushStatus {
	branch: string | null;
	ahead: number;
	behind: number;
	hasUpstream: boolean;
	hasRemote: boolean;
	// Commits this branch has that the repo's default branch does not. Used to
	// decide whether a PR would have any content. 0 when on the default branch
	// or when the branch hasn't diverged.
	aheadOfDefault: number;
	// Commits the default branch has that this branch doesn't — how far behind the
	// default the branch is, and what "update from <default>" would merge in.
	// Compared against origin/<default> when a remote exists, else the local
	// default branch. 0 on the default branch itself.
	behindDefault: number;
	// Name of the remote the branch's upstream lives on (`branch.<x>.remote`).
	// Usually "origin", but a checked-out PR branch tracks the PR's head repo
	// remote. Undefined when there's no upstream. Drives accurate push labels.
	pushRemote?: string;
}

export interface PullPushResult {
	ok: boolean;
	conflicts: string[];
	error?: string;
	// Files a pull couldn't proceed over because they carry uncommitted local
	// changes git would overwrite (the "your local changes would be overwritten"
	// abort). Distinct from `conflicts` (unmerged paths) — this is the blocked-pull
	// signal that drives the stash prompt. Unset when the failure wasn't a block.
	blockedFiles?: string[];
	// A push the remote refused because it has commits we don't ("! [rejected]
	// ... (fetch first)" / "(non-fast-forward)"). The renderer pushes without a
	// fetch first and uses this to fall back to fetch, pull, push. Unset for any
	// other failure (auth, network, hooks).
	nonFastForward?: boolean;
}

// A managed stash: a normal git stash whose message carries the
// `!!super-review<branch>` marker so the app never touches user-created stashes.
// `ref` is the resolved commit SHA (not `stash@{n}`, whose index shifts);
// `fileCount` is how many files the stash captures, for the sidebar label.
export interface ManagedStash {
	ref: string;
	fileCount: number;
}

export interface CommitResult {
	ok: boolean;
	error?: string;
	// Stats for the commit that was just created (the new HEAD vs its parent),
	// used to record "files/lines committed" usage stats. Present only on success.
	filesCommitted?: number;
	linesCommitted?: number;
	// HEAD as the operation left it — the new commit after a commit, the parent
	// after an undo, null when that leaves HEAD unborn. Lets the caller update the
	// "last commit" row right away instead of waiting on the refresh chain (which
	// includes a GitHub round-trip). Present only on success.
	lastCommit?: LastCommit | null;
}

// One file's contribution to a commit. For whole-file staging only `path`
// (and `oldPath` for renames) is set and the file's full working-tree version
// is committed. For partial (line/hunk) staging `patch` carries a ready-to-
// apply unified diff (HEAD -> the desired subset of changes); the backend
// applies it to a scratch index so only the selected lines land in the commit.
export interface CommitFileSelection {
	path: string;
	oldPath?: string;
	patch?: string;
}

// Whether a harness CLI is signed in.
//   'ok'      — the CLI reported a live session; generation will reach a model.
//   'missing' — the CLI reported no session. Generation would fail; the UI says
//               so up front and offers the login command.
//   'unknown' — we couldn't tell (probe timed out, unrecognized output, or the
//               CLI has no way to ask). Treated as usable: never block a run on
//               our own ignorance, and let the runtime error classify it.
export type HarnessAuthState = 'ok' | 'missing' | 'unknown';

// What one harness CLI looks like on this machine. `installed` is the old
// boolean; the auth fields come from a probe that runs the CLI's own
// "am I signed in" path (see main/commit-message/auth-probe.ts).
export interface CommitMessageHarnessInfo {
	installed: boolean;
	auth: HarnessAuthState;
	// The signed-in identity, when the CLI reports one ("you@example.com").
	account?: string;
	// The plan/subscription the CLI reported ("max", "pro"), when it says.
	plan?: string;
}

// Which harness CLIs are installed, on PATH, and signed in. Drives the Agents
// settings picker and the "set up commit message generation" notice.
export type CommitMessageHarnessStatus = Record<CommitMessageHarness, CommitMessageHarnessInfo>;

// Convenience for the many call sites that only care whether a harness can be
// picked at all. Auth deliberately doesn't gate this: a signed-out CLI still
// appears, with its state shown, so the user can fix it rather than wonder
// where it went.
export function isHarnessInstalled(
	status: CommitMessageHarnessStatus | null | undefined,
	harness: CommitMessageHarness
): boolean {
	return status?.[harness]?.installed ?? false;
}

// What the renderer sends when the user clicks Generate in the commit box.
// Selections match what Commit would include (checked files + filtered patches).
export interface GenerateCommitMessageRequest {
	branch: string | null;
	selections: CommitFileSelection[];
	// Preferred harness from prefs; main process falls back if missing/uninstalled.
	preferredHarness?: CommitMessageHarness | null;
	// Editable base instructions (no files/patch). Empty/omitted uses the default.
	basePrompt?: string | null;
	// Model id for the chosen harness. Empty/omitted uses that harness's default.
	model?: string | null;
}

export interface GenerateCommitMessageResult {
	ok: boolean;
	subject?: string;
	body?: string;
	harness?: CommitMessageHarness;
	error?: string;
	code?: 'no-harness' | 'auth' | 'timeout' | 'failed' | 'empty' | 'cancelled';
}

// A model option for the commit-message generate popover.
export interface CommitMessageModelOption {
	id: string;
	label: string;
}

// Progress while a commit message is generating. The two channels are kept
// apart because they land in different places: the answer is the commit message
// itself and streams straight into the commit box, while the reasoning is just
// the model thinking out loud.
export interface CommitMessageProgressEvent {
	reasoning: string;
	answer: string;
}

// One file to discard. `oldPath` is the pre-rename path, so discarding a rename
// also restores the original. Shared by the single- and bulk-discard APIs.
export interface DiscardTarget {
	path: string;
	oldPath?: string;
}

export interface LastCommit {
	hash: string;
	subject: string;
	// The message below the subject, blank separator line already dropped.
	// Empty for a subject-only commit. Lets undo restore the full message to the
	// commit box with no round-trip.
	body: string;
	// Relative time string straight from git (e.g. "2 minutes ago").
	relativeTime: string;
	// True when the commit has not yet been pushed to any remote, so undoing it
	// is safe.
	canUndo: boolean;
	// How many commits (this one included) are on HEAD but not on any remote.
	// Drives the commit box's "more commits" summary; 1 when it can't be counted.
	unpushedCount: number;
}

// One file touched by a local commit, as listed in the commit box's summary of
// everything waiting to be pushed.
export interface LocalCommitFile {
	path: string;
	// Pre-rename path, when git detected the change as a rename or copy.
	oldPath?: string;
	status: FileStatus;
	additions: number;
	deletions: number;
	isBinary: boolean;
}

// How many local commits `listLocalCommits` reports by default. Well past what
// anyone stacks up before pushing, and it keeps the summary panel's work bounded
// on a repo with no remotes at all (where every commit counts as local). The
// panel says so when the list is capped, so keep the two in step.
export const LOCAL_COMMITS_LIMIT = 50;

// A commit that exists only locally (isn't on any remote), with the line counts
// and file list needed to summarize it without opening its diff.
export interface LocalCommit {
	hash: string;
	shortHash: string;
	// First line of the commit message.
	subject: string;
	authorName: string;
	authorEmail: string;
	// Unix epoch ms of the author date.
	authoredAt: number;
	// Totals across `files`. Zero for a merge commit, which reports no files.
	additions: number;
	deletions: number;
	files: LocalCommitFile[];
}

export interface CreateBranchResult {
	ok: boolean;
	error?: string;
}

export interface DeleteBranchResult {
	ok: boolean;
	error?: string;
}

// An in-progress commit message the user hasn't committed yet. Persisted
// per-repo so switching repos / restarting the app restores what was typed.
export interface CommitDraft {
	summary: string;
	description: string;
	// When the draft was auto-filled from a changeset and is still untouched, the
	// repo-relative path of that changeset. Persisted so the "detected from
	// changeset" link survives leaving and returning to the repo (drives clearing
	// the message if that changeset is later removed). Absent once the user edits.
	changesetPath?: string;
}

export interface CloneResult {
	ok: boolean;
	path?: string;
	error?: string;
}

// Options for the GitHub-Desktop-style "Create new repository" flow. The repo
// is created at `<path>/<name>` and optionally scaffolded with a README, a
// .gitignore (from a bundled template), and a LICENSE.
export interface CreateRepoOptions {
	/** Parent directory the new repo folder is created inside. */
	path: string;
	/** Repo folder name (also used as the project title in the README). */
	name: string;
	/** Optional one-line description, written to the README and .git/description. */
	description?: string;
	/** Seed the repo with a README.md. */
	initReadme?: boolean;
	/** .gitignore template label (see repos.getCreateDefaults), or null for none. */
	gitignore?: string | null;
	/** License template label (see repos.getCreateDefaults), or null for none. */
	license?: string | null;
	/**
	 * GitHub account the new repo is pinned to (also the identity used for the
	 * remote name-collision check). Null/undefined means "use the app default
	 * account" (no pin), and also skips the check when no account is signed in.
	 */
	accountId?: string | null;
	/**
	 * Namespace the remote name-collision check runs against: an organization
	 * login, or undefined for the account's personal namespace. Only affects the
	 * check, not where the local repo is created.
	 */
	owner?: string;
}

// A repository that already exists on a GitHub account, surfaced when the
// create-repo form's name would collide with a remote under the chosen owner.
export interface RemoteRepoRef {
	/** Owner login (the org, or the checked account's login). */
	owner: string;
	/** Repository name on GitHub. */
	name: string;
	/** Link to the existing repo on github.com. */
	htmlUrl: string;
}

// Defaults the create-repo form loads up front: a suggested parent directory
// and the available template labels for the two dropdowns.
export interface CreateRepoDefaults {
	defaultPath: string;
	gitignores: string[];
	licenses: string[];
}

// A GitHub organization the signed-in account can create repositories under,
// surfaced in the Publish Repository dialog's "Organization" dropdown.
export interface GithubOrg {
	login: string;
	avatarUrl?: string;
}

// Options for the GitHub-Desktop-style "Publish Repository" flow: create the
// repo on GitHub, wire it up as `origin`, and push the current branch.
export interface PublishRepoOptions {
	/** Repo name on GitHub (defaults to the local folder name). */
	name: string;
	/** Optional one-line description set on the GitHub repo. */
	description?: string;
	/** Create as a private repository ("Keep this code private"). */
	private: boolean;
	/** Org login to create the repo under, or null for the personal account. */
	org?: string | null;
}

// Accent palette: 'super' is the brand flame, 'mono' the neutral monochrome
// primary. Each maps to an `.accent-*` class in app.css.
export type Accent = 'super' | 'mono';

// Window sizing defaults and minimums, shared between the main process (which
// creates the BrowserWindow) and the App settings UI (which validates the
// user's input against them). Logical pixels.
export const WINDOW_BOUNDS = {
	defaultWidth: 1250,
	defaultHeight: 825,
	minWidth: 720,
	minHeight: 480
} as const;

// Visibility of the optional, user-hidable controls in the top header. The
// repo/branch picker, account switcher, refresh, update-branch, and primary
// action buttons are always present and aren't listed here. Toggled from the
// header's right-click menu; persisted in UserPrefs.
export interface HeaderItemVisibility {
	// The left "Changes" file-list sidebar toggle (panel-left icon), pinned to
	// the left side of the header.
	changesToggle: boolean;
	// The right "Comments" sidebar toggle (panel-right icon), pinned to the
	// right side of the header.
	commentsToggle: boolean;
	// The "Add a changeset" button (only ever shown when the repo uses changesets).
	changeset: boolean;
	// The "Open in editor" button.
	editor: boolean;
	// The "Open in terminal" button.
	terminal: boolean;
}

// Everything visible by default; the user hides what they don't want.
export const DEFAULT_HEADER_ITEMS: HeaderItemVisibility = {
	changesToggle: true,
	commentsToggle: true,
	changeset: true,
	editor: true,
	terminal: true
};

// Which blocks the "No local changes" empty view shows. Each is toggled from the
// empty view's right-click native context menu; missing keys fall back to
// DEFAULT_EMPTY_VIEW_ITEMS so older prefs (and future additions) default visible.
export interface EmptyViewItemVisibility {
	// The "Open in <editor>" action card.
	editor: boolean;
	// The "Show in Finder/Explorer/File Manager" action card.
	reveal: boolean;
	// The "View on GitHub" action card.
	github: boolean;
	// The local usage-stats dashboard.
	stats: boolean;
}

export const DEFAULT_EMPTY_VIEW_ITEMS: EmptyViewItemVisibility = {
	editor: true,
	reveal: true,
	github: true,
	stats: true
};

// Which of the sidebar's optional tab-strip-row items are shown. The Unstaged
// and Branch tabs have their own contextual visibility (a read-only view hides
// Unstaged; a default-branch checkout hides Branch), so only Sessions and
// History are user-toggleable. The trailing summary (review progress, changed-
// line counts) and the collapse-sidebar button that share the row are toggled
// here too. All hidden/shown via the tab strip's right-click native context
// menu, mirroring the header's "Show in header" menu.
export interface SidebarTabVisibility {
	sessions: boolean;
	history: boolean;
	// The "seen / total" review-progress count (hidden on the Unstaged tab).
	reviewProgress: boolean;
	// The +additions / −deletions changed-line totals.
	lineCounts: boolean;
	// The collapse-sidebar button (panel-left icon) pinned to the right of the
	// row. Distinct from the header's `changesToggle`, which reopens the sidebar
	// from the top bar once collapsed.
	collapseToggle: boolean;
}

// Everything shown by default; the user hides what they don't want.
export const DEFAULT_SIDEBAR_TABS: SidebarTabVisibility = {
	sessions: true,
	history: true,
	reviewProgress: true,
	lineCounts: true,
	collapseToggle: true
};

// Which of the sidebar's file-controls-row buttons are shown. The file search
// box is structural and always present; only these auxiliary buttons are
// user-toggleable, via the controls row's right-click native context menu,
// mirroring the header's "Show in header" menu. Persisted in UserPrefs.
export interface SidebarControlVisibility {
	// The "Collapse all seen" button (fold-vertical icon) that collapses every
	// already-seen file's diff at once.
	collapseSeen: boolean;
	// The tree / list layout toggle.
	viewToggle: boolean;
}

// Both buttons shown by default; the user hides what they don't want.
export const DEFAULT_SIDEBAR_CONTROLS: SidebarControlVisibility = {
	collapseSeen: true,
	viewToggle: true
};

// Which optional controls each diff file's sticky header shows. The chevron,
// file icon, path and status badges are structural and always present; only
// these auxiliary controls are user-toggleable, via the file header's
// right-click native context menu. Persisted in UserPrefs.
export interface FileHeaderItemVisibility {
	// The per-file "Open in editor" button.
	editor: boolean;
	// The +additions / −deletions changed-line counts.
	changedLines: boolean;
	// The Diff / Raw view toggle that swaps the rendered diff for the whole file.
	viewToggle: boolean;
	// The "Mark seen" button.
	markSeen: boolean;
}

// Everything visible by default; the user hides what they don't want.
export const DEFAULT_FILE_HEADER_ITEMS: FileHeaderItemVisibility = {
	editor: true,
	changedLines: true,
	viewToggle: true,
	markSeen: true
};

export interface UserPrefs {
	viewMode: ViewMode;
	// Whether the diff view scrolls through all files at once ('scroll') or shows
	// one file's diff at a time ('single'). Defaults to 'scroll'.
	diffLayout: DiffLayout;
	theme: 'light' | 'dark';
	// Syntax-highlighting theme for diff code blocks, identified by a preset id
	// from DIFF_THEMES (see the renderer's lib/diff-themes). Each preset bundles a
	// dark and a light variant, so the diff follows the app's light/dark `theme`.
	// Defaults to 'pierre'. Unknown ids fall back to the default at resolve time.
	diffTheme: string;
	accent: Accent;
	activeRepoId?: string;
	contextTab?: ContextTab;
	externalEditor?: EditorKind | null;
	externalTerminal?: TerminalKind | null;
	// Preferred coding-harness CLI for generating commit messages. Null means
	// auto-pick the first installed harness. Excludes `other` (no CLI to spawn).
	commitMessageHarness?: CommitMessageHarness | null;
	// Editable base prompt for commit-message generation (no files/patch). Null
	// or empty means the built-in default. Persisted so the popover remembers it.
	commitMessagePrompt?: string | null;
	// Preferred model id per harness for commit-message generation.
	commitMessageModels?: Partial<Record<CommitMessageHarness, string>>;
	// Editable base prompt for changeset generation (no packages/patch). Null or
	// empty means the built-in default. Shares the harness/model prefs above;
	// only the instructions differ between the two kinds of generation.
	changesetPrompt?: string | null;
	// File list layout is tracked per sidebar tab so the user can keep, say, a
	// tree in Unstaged and a flat list in Branch.
	unstagedFileListLayout: FileListLayout;
	branchFileListLayout: FileListLayout;
	showFileIcons: boolean;
	// When true, moving the file-tree keyboard cursor onto a file opens its diff
	// immediately. When false, arrows only move the focus ring and Enter/Space
	// opens the focused file.
	openFileOnArrowNav: boolean;
	// Font family for the diff/code surface. "system" uses the built-in
	// monospace stack; any other value is a family name installed on the
	// user's machine.
	codeFont: string;
	// Draw vertical indentation guide lines in diff code (like an editor's
	// indent guides), so nesting depth stays readable. On by default.
	indentGuides: boolean;
	// Font family for the app UI (sidebar, lists, chrome). "system" uses the
	// built-in sans stack; any other value is an installed family name.
	uiFont: string;
	// Diffs whose changed-line count (additions + deletions) exceeds this are
	// hidden behind a "Load diff" button by default. 0 disables the size check.
	maxDiffLines: number;
	// Glob patterns whose matching files have their diffs hidden behind a
	// "Load diff" button by default (lock files, build outputs, etc.). See
	// DEFAULT_HIDDEN_DIFF_PATTERNS in @shared/diff-defer for match semantics.
	hiddenDiffPatterns: string[];
	// User-registered icons for files matching a glob pattern. When a file matches
	// one of these, its custom icon overrides the built-in language icon
	// everywhere file icons are shown. Pattern semantics match hiddenDiffPatterns
	// (see @shared/diff-defer). Empty by default.
	customFileIcons: CustomFileIcon[];
	// How much UI motion to apply. Defaults to 'accents': accent-level motion on,
	// overlay surfaces (menus/dialogs) instant. See AnimationMode. Consumed via the
	// useAnimations() context hook.
	animations: AnimationMode;
	// What to do when a checked-out branch's PR is detected going from unmerged →
	// merged: ask via a dialog ('prompt', the default), switch back to the default
	// branch automatically ('switch'), or do nothing ('nothing').
	prMergedBehavior: PrMergedBehavior;
	// After switching back to the default branch because a branch's PR merged,
	// delete the now-merged local branch automatically instead of prompting. Off
	// by default — the user is asked each time via a dialog.
	autoRemoveMergedBranch: boolean;
	// When a file the user already marked "seen" picks up new changes (e.g. fresh
	// commits pushed to the branch, or further working-tree edits), clear its seen
	// mark so it resurfaces for re-review. On by default. Detected by comparing a
	// per-file content signature captured at mark-seen time against the current
	// one (see fileSeenSig in the renderer store).
	unmarkSeenOnChange: boolean;
	// User-configurable keyboard shortcuts, keyed by action. See DEFAULT_HOTKEYS
	// in @shared/hotkeys for the defaults and matching semantics.
	hotkeys: Hotkeys;
	// Size of the app window when it opens, in logical pixels. Clamped to
	// WINDOW_BOUNDS.min* by the main process. These are the initial bounds only —
	// resizing an open window doesn't change them; they apply to the next launch.
	windowWidth: number;
	windowHeight: number;
	// When true, the window opens maximized. windowWidth/windowHeight still serve
	// as the pre-maximize ("restore") bounds.
	startMaximized: boolean;
	// Persisted open/closed state of the two main sidebars, so the layout the user
	// left survives a restart. `sidebarCollapsed` is the left file-list sidebar
	// (true = collapsed); `commentsSidebarOpen` is the right comments panel.
	sidebarCollapsed: boolean;
	commentsSidebarOpen: boolean;
	// Which tab the right sidebar reopens on — the branch task list, the line/review
	// Comments list, or the PR Conversation feed. Persisted so the choice survives a
	// restart.
	commentsSidebarTab: 'tasks' | 'comments' | 'conversation';
	// When true, the comments panel takes over the whole work area (the diff pane
	// is collapsed to zero). Only reachable while the left sidebar is collapsed;
	// reopening the left sidebar exits it. Persisted so it survives a restart.
	conversationFullscreen: boolean;
	// How many recently opened repositories the repo picker's "Recent" section
	// lists. 0 hides the section entirely.
	recentRepoCount: number;
	// Whether the changesets integration is active: the "Add a changeset?" prompt,
	// the unnecessary-changeset warning, commit-message auto-fill, and the toolbar
	// button. On by default; turn off to silence all changeset behavior.
	changesetsEnabled: boolean;
	// SSH-sign every commit. On by default: the app provisions a per-account
	// ed25519 signing key, registers it with GitHub so commits show "Verified",
	// and signs without any setup. Silently no-ops on machines whose git or
	// ssh-keygen is too old (see checkSshSigningSupported), and any signing
	// failure falls back to an unsigned commit. Turn off to commit unsigned.
	signCommits: boolean;
	// Check for and download app updates in the background. On by default. During
	// beta the Updates settings toggle is locked on so users can't opt out; the
	// pref is still persisted so post-beta we can honor it without a migration.
	automaticUpdates: boolean;
	// Which optional header controls are shown. Toggled from the header's
	// right-click menu. Missing keys fall back to DEFAULT_HEADER_ITEMS so older
	// persisted prefs (and any future additions) default to visible.
	headerItems: HeaderItemVisibility;
	// Which optional sidebar tabs (Sessions, History) are shown. Toggled from the
	// tab strip's right-click menu. Missing keys fall back to DEFAULT_SIDEBAR_TABS
	// so older persisted prefs (and any future additions) default to visible.
	sidebarTabs?: SidebarTabVisibility;
	// Which optional sidebar controls-row buttons (collapse-all-seen, tree/list
	// toggle) are shown. Toggled from the controls row's right-click menu. Missing
	// keys fall back to DEFAULT_SIDEBAR_CONTROLS so older persisted prefs (and any
	// future additions) default to visible.
	sidebarControls: SidebarControlVisibility;
	// Which optional controls each diff file header shows. Toggled from the file
	// header's right-click menu. Missing keys fall back to DEFAULT_FILE_HEADER_ITEMS
	// so older persisted prefs (and any future additions) default to visible.
	fileHeaderItems: FileHeaderItemVisibility;
	// Which metric widgets the stats Overview shows, in order. Customized from the
	// Overview's widget picker. Falls back to DEFAULT_STATS_WIDGETS when unset.
	statsWidgets?: StatMetric[];
	// Which blocks the "No local changes" empty view shows. Toggled from its
	// right-click menu. Missing keys fall back to DEFAULT_EMPTY_VIEW_ITEMS.
	emptyViewItems: EmptyViewItemVisibility;
}

// A user-registered file icon: every file whose path matches `pattern` is
// badged with the image at `source` instead of its built-in language icon.
export interface CustomFileIcon {
	// Glob pattern matched against the file path. Same semantics as
	// hiddenDiffPatterns: no slash matches the basename anywhere in the tree
	// (e.g. `*.proto`, `Dockerfile`); a slash anchors to the full repo-relative
	// path (e.g. `infra/**`). Matching is case-insensitive.
	pattern: string;
	// Where the icon image comes from: an `https://` URL, a `data:` URI, or an
	// absolute local file path. Local paths are read by the main process and
	// inlined as a data URI because the renderer's CSP blocks `file://`.
	source: string;
}

export interface DeviceFlowStart {
	userCode: string;
	verificationUri: string;
	expiresInSec: number;
	intervalSec: number;
}

export interface GithubAccount {
	id: string;
	login: string;
	name?: string;
	avatarUrl?: string;
	addedAt: number;
}

// A GitHub user the review composer can @-mention. Sourced from the repo's
// assignable users (collaborators + org members GitHub lets you assign), which
// is the read-access approximation of GitHub's own mention suggestion list.
export interface MentionableUser {
	login: string;
	avatarUrl: string;
}

// An issue or pull request the review composer can #-reference. `isPullRequest`
// distinguishes the two (GitHub numbers them in one shared sequence), and
// `state`/`draft`/`merged` drive the status icon in the typeahead — the same
// distinctions the PR list makes.
export interface IssueReference {
	number: number;
	title: string;
	state: 'open' | 'closed';
	isPullRequest: boolean;
	draft?: boolean;
	merged?: boolean;
}

export type DeviceFlowStatus =
	| { state: 'pending' }
	| { state: 'success'; account: GithubAccount }
	| { state: 'error'; message: string };

// A stored account whose token needs the user to re-authenticate: 'revoked'
// when GitHub rejects the credential outright (revoked or expired token), 'sso'
// when the token is fine but an organization's SAML session must be
// re-authorized, 'scope' when the token predates a scope the app now needs
// (e.g. write:ssh_signing_key for commit signing) so signing in again grants it.
// Surfaced so the UI can prompt the user to sign in again — without this, a
// dead token just makes the app silently behave as if access were missing.
export interface GithubAuthError {
	accountId: string;
	login: string;
	reason: 'revoked' | 'sso' | 'scope';
}

// --- Licensing ---------------------------------------------------------------
// The plan claim carried by a signed license token.
export type LicensePlan = 'trial' | 'lifetime';

// Why the app is locked. `offline_expired`: the cached token expired and the
// server was unreachable. `clock_rollback`: the system clock ran backwards, so
// the cached token can't be trusted until an online check. The rest mirror the
// server's denial reasons.
export type LicenseLockReason =
	// The account is on the beta waitlist but has not been accepted yet. Only
	// possible while the server has waitlist mode on.
	| 'waitlist'
	| 'trial_expired'
	| 'suspended'
	| 'offline_expired'
	| 'revoked'
	| 'fingerprint_mismatch'
	| 'clock_rollback';

// Display identity of the license holder, carried in the signed token so the
// desktop can show the account the license actually belongs to.
export interface LicenseHolder {
	name?: string;
	email?: string;
	avatarUrl?: string;
}

// The main process's authoritative license state. The renderer mirrors this but
// never decides on it — the IPC gate reads the main-process copy.
export type LicenseState =
	| { state: 'unlicensed' }
	| { state: 'activating' }
	| {
			state: 'licensed';
			plan: LicensePlan;
			status: 'active' | 'trialing';
			// Present while trialing: ms epoch the trial ends.
			trialEndsAt?: number;
			// ms epoch the perpetual license was purchased.
			// Display only — drives "Active since" on the license card.
			activeSince?: number;
			// Who the license belongs to. Comes from the server (the desktop's local
			// GitHub sign-ins are a separate thing and often a different account).
			holder?: LicenseHolder;
			// ms epoch the cached token expires — the offline budget runs out here.
			offlineExpiresAt: number;
	  }
	| { state: 'locked'; reason: LicenseLockReason };

// Status of an in-progress device-code activation, polled by the renderer.
// `waiting` carries the user code to display and the URL where it is entered;
// the main process polls the server in the background until the browser side is
// approved or denied.
export type ActivationStatus =
	| { state: 'idle' }
	| { state: 'waiting'; userCode: string; verificationUri: string }
	| { state: 'success'; license: LicenseState }
	| { state: 'denied' } // the user rejected the request in the browser
	| { state: 'error'; message: string };

// Live state of the electron-updater background update, pushed from the main
// process to the renderer (updater:status) and mirrored in the app store. Drives
// the update toast: `downloading` shows a progress bar, `downloaded` shows the
// "Restart to update" button. `available`/`checking`/`error` are informational
// (the toast stays quiet for them); `not-available` collapses to `idle`.
export type UpdateStatus =
	| { state: 'idle' }
	| { state: 'checking' }
	| { state: 'available'; version: string }
	| {
			state: 'downloading';
			version: string;
			// 0–100, already rounded for display.
			percent: number;
			bytesPerSecond: number;
			transferred: number;
			total: number;
	  }
	| { state: 'downloaded'; version: string }
	| { state: 'error'; message: string };

// The decoded claims of a license token (post-signature-verify). Field names
// match the JWT payload the web app signs.
export interface LicenseClaims {
	// Standard JWT claims.
	sub: string; // userId
	aud: string;
	iss: string;
	iat: number; // seconds
	exp: number; // seconds
	// App claims.
	lic: string; // licenseId
	dev: string; // deviceId
	plan: LicensePlan;
	sta: 'active' | 'trialing';
	fp: string; // sha256(machineFingerprint)
	tex: number | null; // display expiry (trialEndsAt, or null for perpetual)
	// ms epoch the paid plan started. Optional so tokens minted before this claim
	// existed still parse (an older cached token just won't show "Active since").
	since?: number | null;
	// Holder display identity (name / email / avatar). Optional for the same
	// backward-compatibility reason as `since`.
	hn?: string | null;
	he?: string | null;
	hi?: string | null;
}

// Trimmed npm-registry metadata for a single package, surfaced in the diff
// viewer's package.json hover cards. The full registry document is large (it
// inlines every version's manifest); the main process strips it down to just
// what the cards render. `time` maps a version (plus the synthetic `created` /
// `modified` keys npm includes) to its ISO publish timestamp.
export interface NpmPackageInfo {
	name: string;
	description?: string;
	// `dist-tags.latest` — the version `npm install <name>` resolves to.
	latestVersion?: string;
	homepage?: string;
	// Normalized to a browsable https URL (git+ssh / git+https forms are cleaned).
	repositoryUrl?: string;
	license?: string;
	author?: string;
	keywords?: string[];
	// version (or 'created' / 'modified') → ISO publish timestamp.
	time: Record<string, string>;
	// Deprecation message keyed by version, when the registry marks one.
	deprecations?: Record<string, string>;
}

// Result of an npm lookup: either the trimmed info or a human-readable error
// (offline, 404, rate-limited) the hover card can show instead of spinning.
export type NpmPackageResult = { ok: true; info: NpmPackageInfo } | { ok: false; error: string };

// A GitHub release's notes, for the hover card's "What's new" disclosure. `body`
// is the raw release-notes markdown (the card renders it); `htmlUrl` links to
// the release page on GitHub.
export interface ReleaseNotes {
	tag: string;
	name?: string;
	body?: string;
	htmlUrl: string;
	publishedAt?: string;
}

// Result of a release-notes lookup. `release` is null when the package isn't on
// GitHub or has no release matching the version (the card still shows a plain
// changelog link). Errors resolve as a variant rather than rejecting so the card
// can degrade to just the link.
export type ReleaseNotesResult =
	| { ok: true; release: ReleaseNotes | null }
	| { ok: false; error: string };

// Result of a release-notes RANGE lookup: every release strictly above the lower
// version and up to (and including) the higher one, newest first. Used when a
// dependency's version changed in the diff so the card can show everything that
// changed between the two versions. `truncated` is true when more releases exist
// than we fetched/returned (the card then points at the full changelog).
export type ReleaseNotesRangeResult =
	| { ok: true; releases: ReleaseNotes[]; truncated: boolean }
	| { ok: false; error: string };

// ─── AI file configuration ────────────────────────────────────────────────
// The "Configure AI files" feature installs the super-review skill and the
// tour-author subagent into the directories each coding agent reads, at project
// or global (home) scope. See ai-config-paths.ts for the per-harness path table.

// Which artifact an install targets, and at which scope.
export type AiArtifact = 'skill' | 'subagent';
export type AiScope = 'project' | 'global';
// An install target: the shared `.agents` convention (covers the skill for
// Cursor, Codex, opencode, and Copilot, plus subagents for the agents that read
// `.agents/agents`), or an agent that needs its own location. Claude Code reads
// only its own dirs. Codex reads the skill from `.agents` but needs its subagent
// in a native TOML file, so it's offered separately when a subagent is selected.
export type TargetKind = 'standard' | 'claude-code' | 'codex';

// Detected install state for one artifact at one scope of one target. `installed`
// is the presence of the skill dir's SKILL.md / the subagent file;
// `updateAvailable` is true when an installed copy is behind the bundled one
// (skill: `metadata.version` compare; subagent: content compare). Always false
// when not installed.
export interface AiArtifactStatus {
	installed: boolean;
	updateAvailable: boolean;
	// Resolved absolute path (shown in the dialog as the destination).
	path: string;
}

// Per-target detection. A missing `skill`/`subagent` key means the target has no
// such location. A `global: null` slot means the artifact has no global location
// (e.g. Copilot custom agents are repository-only).
export interface TargetAiStatus {
	target: TargetKind;
	// Whether the harness appears installed (its home config dir exists). Always
	// true for the `standard` target (the shared base).
	harnessDetected: boolean;
	// One entry per bundled skill the target can carry (each its own directory,
	// versioned independently), or undefined when the target has no skill location
	// of its own. `name` is the skill's directory name (its install identity).
	skills?: Array<{ name: string; project: AiArtifactStatus; global: AiArtifactStatus | null }>;
	subagent?: { project: AiArtifactStatus; global: AiArtifactStatus | null };
}

// Full detection across every target for a repo. The rollups drive the
// "Configure AI files?" / "Update AI files?" notices without re-scanning.
export interface AiConfigStatus {
	targets: TargetAiStatus[];
	anyInstalled: boolean;
	anyUpdateAvailable: boolean;
}

// One requested write; the Configure dialog emits a list of these.
export interface AiConfigInstallItem {
	target: TargetKind;
	artifact: AiArtifact;
	scope: AiScope;
	// Which bundled skill to write, by directory name. Required when
	// `artifact === 'skill'`; ignored for the subagent.
	skill?: string;
}
export interface AiConfigApplyRequest {
	items: AiConfigInstallItem[];
}
// Per-item outcome so a single failed write (e.g. a permission error on a global
// path) surfaces without aborting the rest.
export interface AiConfigApplyResult {
	results: Array<{ item: AiConfigInstallItem; ok: boolean; error?: string }>;
}
// Outcome of removing one installed skill/subagent from disk.
export interface AiConfigRemoveResult {
	ok: boolean;
	error?: string;
}

// A live prefs update pushed from the main process, either because settings.json
// was edited externally or because a settings file was imported/reset. `reset`
// lists any settings that were present but invalid and fell back to their
// default; `malformed` means the file couldn't be parsed at all (last-good prefs
// are kept). The renderer applies `prefs` and can warn from `reset`/`malformed`.
export interface PrefsChange {
	prefs: UserPrefs;
	reset: string[];
	malformed: boolean;
}

export interface PreloadAPI {
	platform: AppPlatform;
	license: {
		getStatus(): Promise<LicenseState>;
		// Requests a device code from the server and opens the browser to the
		// activation page. Returns the user code to display and where to enter it.
		startActivation(): Promise<{ userCode: string; verificationUri: string }>;
		pollActivation(): Promise<ActivationStatus>;
		cancelActivation(): Promise<void>;
		// Re-open the browser verification page for the in-progress activation.
		openVerification(): Promise<void>;
		// Force an immediate online revalidation (e.g. after "I've subscribed").
		recheck(): Promise<LicenseState>;
		signOut(): Promise<void>;
		openPricing(): Promise<void>;
		// Opens the web dashboard, where the license, billing, and activated
		// devices are managed.
		openDashboard(): Promise<void>;
	};
	updater: {
		// The running app's version (e.g. "0.1.27"), shown in the Updates settings
		// tab so the user can see what they're on.
		getVersion(): Promise<string>;
		// Current background-update state, so a window opened after a download
		// already completed can seed its toast instead of waiting for the next
		// event. Resolves `{ state: 'idle' }` in dev (no packaged app to update).
		getStatus(): Promise<UpdateStatus>;
		// Trigger an immediate update check (the app also checks on launch and on a
		// timer). No-op in dev.
		check(): Promise<void>;
		// Quit and install a downloaded update now. Only meaningful in the
		// `downloaded` state; a no-op otherwise.
		quitAndInstall(): void;
	};
	repos: {
		list(): Promise<RepoInfo[]>;
		openPicker(): Promise<RepoInfo | null>;
		// Register an existing git repo at a known path (no picker). Backs the
		// create-repo form's "this is already a repo — add it instead" shortcut.
		addByPath(path: string): Promise<RepoInfo | null>;
		// Pick a parent folder; scan it for git repos, add them all, and return the
		// ones that were found (empty if the picker was cancelled).
		openFolder(): Promise<RepoInfo[]>;
		// Open a folder picker and return the chosen parent directory (null if
		// cancelled). Used by the create-repo form's "Choose…" button.
		chooseDirectory(): Promise<string | null>;
		// Whether `path` is already a git repository — drives the form's "this is
		// already a repo, add it instead?" hint.
		isGitRepo(path: string): Promise<boolean>;
		// Suggested parent directory + template labels for the create-repo form.
		getCreateDefaults(): Promise<CreateRepoDefaults>;
		// Whether a repo named `name` already exists under `owner` (an org login, or
		// the account's own login when omitted), authenticating as `accountId`.
		// Drives the create-repo form's "this already exists" hint so we don't
		// scaffold a local repo that can't be published. Returns the existing repo's
		// ref, or null if it's free (or the check couldn't run).
		checkRemoteRepo(name: string, accountId: string, owner?: string): Promise<RemoteRepoRef | null>;
		// Scaffold a new repository (folder, git init, README/.gitignore/LICENSE).
		// Returns the registered repo, or null if the picker/flow was cancelled.
		createRepo(options: CreateRepoOptions): Promise<RepoInfo | null>;
		// Publish a local repo to GitHub: create the remote, wire it as `origin`,
		// and push the current branch. Returns the refreshed RepoInfo.
		publish(repoId: string, options: PublishRepoOptions): Promise<RepoInfo>;
		// De-register a repo. When `moveToTrash` is set, the repo's folder is also
		// moved to the OS trash (mirrors GitHub Desktop's remove dialog).
		remove(id: string, moveToTrash?: boolean): Promise<void>;
		setActive(id: string): Promise<RepoInfo | null>;
		getActive(): Promise<RepoInfo | null>;
	};
	git: {
		listBranches(repoId: string): Promise<BranchInfo[]>;
		// Local branches no longer present on any remote — the cleanup candidates
		// for "Clean Up Local Branches" (each carrying its stash count).
		listLocalOnlyBranches(repoId: string): Promise<LocalOnlyBranch[]>;
		getCurrentBranch(repoId: string): Promise<string | null>;
		checkout(repoId: string, branch: string): Promise<void>;
		checkoutPR(repoId: string, pr: PRSummary, source?: PRSource): Promise<void>;
		// Enter (or, with null, leave) a linked worktree: working-tree operations
		// for this repo run against that checkout until a real checkout clears it.
		// Passing the repo's own path also leaves. Returns the updated RepoInfo.
		setActiveWorktree(repoId: string, worktreePath: string | null): Promise<RepoInfo>;
		isDirty(repoId: string): Promise<boolean>;
		createBranch(
			repoId: string,
			name: string,
			opts: { base?: string; checkout: boolean }
		): Promise<CreateBranchResult>;
		deleteBranch(
			repoId: string,
			name: string,
			opts: { deleteRemote: boolean; upstream?: string }
		): Promise<DeleteBranchResult>;
		listChangedFiles(repoId: string, ctx: DiffContext): Promise<ChangedFile[]>;
		// Whether a ref resolves to a commit locally. Used on a cold start to
		// confirm a remembered branch base still exists before diffing against it.
		refExists(repoId: string, ref: string): Promise<boolean>;
		getDiff(repoId: string, filePath: string, ctx: DiffContext): Promise<DiffData>;
		fetchOrigin(repoId: string): Promise<{ ok: boolean; error?: string }>;
		getPushStatus(repoId: string): Promise<PushStatus>;
		pull(repoId: string): Promise<PullPushResult>;
		push(repoId: string): Promise<PullPushResult>;
		// Merge `ref` (e.g. "origin/main") into the current branch. Conflicts come
		// back the same way pull does, driving the shared conflict dialog.
		mergeIntoCurrent(repoId: string, ref: string): Promise<PullPushResult>;
		// For a fork: fetch the parent repo's `branch` and merge it into the current
		// branch ("Update from upstream/<branch>"). Conflicts surface like pull.
		updateFromUpstream(repoId: string, branch: string): Promise<PullPushResult>;
		getConflicts(repoId: string): Promise<string[]>;
		// Re-scan the given conflict files: stage any whose conflict markers are
		// gone, and return the paths still unresolved (markers remaining).
		recheckConflicts(repoId: string, files: string[]): Promise<string[]>;
		stageFile(repoId: string, filePath: string): Promise<void>;
		// Discard a file's working-tree + staged changes. `oldPath` is the
		// pre-rename path, so discarding a rename also restores the original.
		discardChanges(repoId: string, filePath: string, oldPath?: string): Promise<void>;
		// Discard a whole set of files' working-tree + staged changes in one batched
		// operation (a couple of git commands under a single index lock) rather than
		// one call per file. Same semantics as discardChanges per file.
		discardFiles(repoId: string, files: DiscardTarget[]): Promise<void>;
		// Discard a subset of a file's working-tree changes (a hunk or one line).
		// `patch` is a working-tree-based unified diff (see buildDiscardPatch) that
		// removes the discarded additions and restores the discarded deletions.
		discardLines(repoId: string, filePath: string, patch: string): Promise<void>;
		// Append one or more patterns to the repo-root .gitignore (creating it if
		// missing), skipping any already present. `patterns` are ready-made
		// gitignore lines: an escaped repo-relative file path, or `*.ext`.
		addToGitignore(repoId: string, patterns: string[]): Promise<void>;
		continueMerge(repoId: string): Promise<PullPushResult>;
		abortMerge(repoId: string): Promise<void>;
		// Stash management (GitHub-Desktop parity): one managed stash per branch,
		// created only when a pull is blocked by uncommitted local changes.
		createManagedStash(repoId: string): Promise<{ ok: boolean; error?: string }>;
		findManagedStash(repoId: string): Promise<ManagedStash | null>;
		// Restore the managed stash by SHA. A clean restore drops the entry; a
		// conflicted one surfaces unmerged paths the same way pull does (no
		// MERGE_HEAD). When the stash's untracked files already exist in the working
		// tree it can't apply — those clashing paths come back in `blockedFiles`
		// with the stash left intact (recover via restoreManagedStashKeepingLocal).
		restoreManagedStash(repoId: string, ref: string): Promise<PullPushResult>;
		// Recover from that untracked-collision case: restore the stash's tracked
		// changes and its non-colliding untracked files, keeping the existing
		// working-tree copies of the clashing files, then drop the entry.
		restoreManagedStashKeepingLocal(repoId: string, ref: string): Promise<PullPushResult>;
		discardManagedStash(repoId: string, ref: string): Promise<void>;
		// Finish/abort a conflicted stash pop — dedicated paths that must not make a
		// merge commit and that drop (or preserve) the marker stash correctly.
		finishStashPop(repoId: string, ref: string): Promise<PullPushResult>;
		abortStashPop(repoId: string): Promise<void>;
		// Stage and commit the given files. Each entry is either a whole-file
		// selection or a partial one carrying a unified diff to apply (line/hunk
		// staging) — see CommitFileSelection.
		commit(repoId: string, message: string, files: CommitFileSelection[]): Promise<CommitResult>;
		getLastCommit(repoId: string): Promise<LastCommit | null>;
		// List commits reachable from `head` (defaults to the checked-out branch),
		// newest first, capped at `limit`. Backs the History tab's commit list.
		listCommits(repoId: string, head?: string, limit?: number): Promise<CommitInfo[]>;
		// Commits on HEAD that aren't on any remote yet, newest first, each with
		// its line counts and touched files. Backs the commit box's summary of
		// what's waiting to be pushed.
		listLocalCommits(repoId: string, limit?: number): Promise<LocalCommit[]>;
		// Most-recent common ancestor of two refs (where `b` diverged from `a`), or
		// null when they share no history. Backs the History tab's fork-point marker.
		mergeBase(repoId: string, a: string, b: string): Promise<string | null>;
		undoLastCommit(repoId: string): Promise<CommitResult>;
		cloneRepo(url: string): Promise<CloneResult>;
		// Repoint `origin` at the user's fork (GitHub Desktop's fork layout). When
		// `contributeToParent` is true the original is kept as `upstream` so the PR
		// list / "Create PR" target the parent; false works the fork standalone.
		// Returns the refreshed RepoInfo describing the fork; the caller then
		// commits/pushes through the normal path.
		convertToFork(
			repoId: string,
			forkOwner: string,
			forkRepo: string,
			contributeToParent: boolean
		): Promise<RepoInfo>;
		// Change an existing fork's contribution target: when `contributeToParent`
		// is true, wire up the parent as `upstream` (so PRs/sync target it); false
		// clears the upstream and works the fork standalone. Returns the refreshed
		// RepoInfo. Backs the Fork Behavior settings pane.
		setForkContribution(repoId: string, contributeToParent: boolean): Promise<RepoInfo>;
	};
	changesets: {
		// Whether this repo uses changesets and whether the current branch is
		// missing one for a package it changed (drives the "Add a changeset?"
		// prompt above the commit box).
		getStatus(repoId: string): Promise<ChangesetStatus>;
		// Write a new `.changeset/<slug>.md` for the selected packages; returns its
		// repo-relative path.
		create(repoId: string, input: CreateChangesetInput): Promise<string>;
		// Delete a changeset file by its repo-relative path (e.g. an unnecessary one).
		remove(repoId: string, path: string): Promise<void>;
		// Turn the preferred harness CLI loose on the branch to write its changesets:
		// it explores the diff with its own tools and writes the `.changeset/*.md`
		// files, restricted to that directory. Resolves once the run is over, with
		// what it wrote read back off disk. Progress streams via
		// events.onChangesetProgress.
		generate(repoId: string, request: GenerateChangesetRequest): Promise<GenerateChangesetResult>;
		// Abort an in-flight generate (returns false when nothing was running).
		cancelGenerate(): Promise<boolean>;
	};
	editor: {
		detect(): Promise<Record<EditorKind, boolean>>;
		open(
			editor: EditorKind,
			target: string,
			line?: number
		): Promise<{ ok: boolean; error?: string }>;
	};
	terminal: {
		detect(): Promise<Record<TerminalKind, boolean>>;
		open(terminal: TerminalKind, target: string): Promise<{ ok: boolean; error?: string }>;
	};
	github: {
		listAccounts(): Promise<GithubAccount[]>;
		// Orgs the repo's account can create repos under (for the publish dialog).
		listOrganizations(repoId?: string): Promise<GithubOrg[]>;
		// Orgs a specific account can create repos under, by account id (for the
		// create-repo form's owner picker, which has no repo yet).
		listAccountOrganizations(accountId: string): Promise<GithubOrg[]>;
		getActiveAccount(): Promise<GithubAccount | null>;
		setActiveAccount(id: string): Promise<GithubAccount | null>;
		removeAccount(id: string): Promise<void>;
		setRepoAccount(repoId: string, accountId: string | null): Promise<RepoInfo | null>;
		startDeviceFlow(): Promise<DeviceFlowStart>;
		pollDeviceFlow(): Promise<DeviceFlowStatus>;
		cancelDeviceFlow(): Promise<void>;
		listPRs(repoId: string, page?: number, source?: PRSource): Promise<PRSummary[]>;
		// Users the composer can @-mention for this repo (its assignable users on
		// the host repo — upstream for a fork, else its own remote). The renderer
		// filters the returned list client-side as the user types.
		listMentionableUsers(repoId: string): Promise<MentionableUser[]>;
		// Recent issues + PRs the composer can #-reference, most-recently-updated
		// first. When `query` is a bare number not already in the recent page, the
		// exact issue/PR is resolved and prepended so any number can be referenced.
		listIssueReferences(repoId: string, query?: string): Promise<IssueReference[]>;
		// Resolve commit authors to their GitHub accounts the way GitHub's commit
		// list does — by asking the API which account each commit's email maps to,
		// something the email alone can't always tell us. `candidates` pairs each
		// author email with a few of their commit SHAs to probe (newest first);
		// returns a map of lowercased email -> identity for the ones GitHub could
		// resolve (empty when the repo isn't on GitHub or no account is signed in).
		resolveCommitAuthors(
			repoId: string,
			candidates: { email: string; shas: string[] }[]
		): Promise<Record<string, CommitAuthorIdentity>>;
		// Resolve (and persist) the repo's upstream/parent if it's a fork. Returns
		// the updated RepoInfo (with upstreamOwner/upstreamRepo set or cleared).
		detectUpstream(repoId: string): Promise<RepoInfo | null>;
		// Whether the project's account can push to `origin`'s repo. False only on
		// a definitive "no" (no GitHub remote, or the API answered and the account
		// lacks push/visibility) — that's what drives the "fork this repo"
		// banner/dialog. null when the answer is unknown (network failure, dead
		// token), so a transient error is never mistaken for missing access.
		getRepoPushAccess(repoId: string): Promise<boolean | null>;
		// Fork the project's `origin` repo under the account; returns the fork's
		// owner/name. Pair with git.convertToFork to rewire the local remotes.
		createFork(repoId: string): Promise<{ owner: string; repo: string }>;
		// The parent of the repo's `origin` if it's a GitHub fork, else null. A
		// pure read (no persistence) — drives the Fork Behavior settings pane.
		getRepoParent(repoId: string): Promise<{ owner: string; repo: string } | null>;
		// `owner`/`repo` name the PR's host (base) repo — the parent for an upstream
		// PR on a fork — so the head and base refs are fetched from the right repo.
		// Omitted, they fall back to the active repo's own coordinates.
		fetchPR(
			repoId: string,
			prNumber: number,
			owner?: string,
			repo?: string
		): Promise<{ headRef: string; baseRef: string }>;
		findPRForBranch(repoId: string, branch: string): Promise<PRSummary | null>;
		// PR operations accept the PR's host repo (owner/repo) so they target the
		// right repository — an upstream PR lives on the parent, not the fork.
		// When omitted, the active repo's own coordinates are used.
		// Whether the active account can push commits to the PR's head branch
		// (direct push access to the head repo, or maintainer-edit on the base).
		// null when the answer couldn't be determined (network failure, dead token).
		canPushToPR(repoId: string, pr: PRSummary): Promise<boolean | null>;
		getChecks(repoId: string, ref: string, owner?: string, repo?: string): Promise<PRChecksSummary>;
		getPR(
			repoId: string,
			prNumber: number,
			owner?: string,
			repo?: string
		): Promise<PRSummary | null>;
		listReviewComments(
			repoId: string,
			prNumber: number,
			owner?: string,
			repo?: string
		): Promise<PRReviewComment[]>;
		createReviewComment(
			repoId: string,
			input: NewReviewCommentInput,
			owner?: string,
			repo?: string
		): Promise<PRReviewComment>;
		replyReviewComment(
			repoId: string,
			prNumber: number,
			commentId: number,
			body: string,
			owner?: string,
			repo?: string
		): Promise<PRReviewComment>;
		deleteReviewComment(
			repoId: string,
			commentId: number,
			owner?: string,
			repo?: string
		): Promise<void>;
		// Edit one of the viewer's own line-anchored review comments. Returns the body
		// as GitHub stored it; the caller merges just the body so the comment's
		// thread/resolution state is preserved.
		updateReviewComment(
			repoId: string,
			commentId: number,
			body: string,
			owner?: string,
			repo?: string
		): Promise<string>;
		// The PR's top-level conversation timeline (issue comments, review summaries,
		// commits and events) in chronological order. Drives the Conversation tab.
		listConversation(
			repoId: string,
			prNumber: number,
			owner?: string,
			repo?: string
		): Promise<PRConversationItem[]>;
		// Post a top-level comment to the PR conversation and return the created item.
		createIssueComment(
			repoId: string,
			prNumber: number,
			body: string,
			owner?: string,
			repo?: string
		): Promise<PRConversationItem>;
		// Delete one of the viewer's own conversation comments.
		deleteIssueComment(
			repoId: string,
			commentId: number,
			owner?: string,
			repo?: string
		): Promise<void>;
		// Edit a conversation comment's body (user edit, or a task-list checkbox
		// toggle). Returns the body as GitHub stored it.
		updateIssueComment(
			repoId: string,
			commentId: number,
			body: string,
			owner?: string,
			repo?: string
		): Promise<string>;
		// Edit the PR description (its body) — the description card's edit and its
		// task-list checkbox toggles. Returns the new body.
		updatePullRequestBody(
			repoId: string,
			prNumber: number,
			body: string,
			owner?: string,
			repo?: string
		): Promise<string>;
		// Merge the PR with the chosen method (merge commit / squash / rebase).
		// Targets the PR's host (base) repo. Returns GitHub's result; `merged` is
		// false when GitHub declined rather than throwing.
		mergePullRequest(
			repoId: string,
			prNumber: number,
			method: PRMergeMethod,
			owner?: string,
			repo?: string,
			// Commit title/message for the merge commit (squash/merge only; rebase
			// ignores them). Omitted lets GitHub use its own defaults.
			commitTitle?: string,
			commitMessage?: string
		): Promise<PRMergeResult>;
		// Take a draft PR out of draft ("Ready for review"). Uses the GraphQL
		// markPullRequestAsReady mutation (REST has no equivalent).
		markPullRequestReady(
			repoId: string,
			prNumber: number,
			owner?: string,
			repo?: string
		): Promise<void>;
		// Resolve or unresolve a review thread by its GraphQL node id. Returns the
		// thread's resolved state as reported back by GitHub.
		setReviewThreadResolved(
			repoId: string,
			threadId: string,
			resolved: boolean
		): Promise<{ isResolved: boolean }>;
		// Accounts currently known to be failing authentication. Hydrates the
		// renderer's auth-error state; live changes arrive via onGithubAuthChanged.
		getAuthErrors(): Promise<GithubAuthError[]>;
		// Probe every stored account's token with a cheap /user call, flagging the
		// ones that no longer authenticate. Returns the resulting error list.
		validateAccounts(): Promise<GithubAuthError[]>;
	};
	state: {
		getPrefs(): Promise<UserPrefs>;
		setPrefs(patch: Partial<UserPrefs>): Promise<UserPrefs>;
		getSeenFiles(repoId: string, contextKey: string): Promise<string[]>;
		// The content signatures captured when each file was marked seen, keyed by
		// path. Drives the "unmark seen when a file changes" behavior — the renderer
		// compares these against the current files' signatures on refresh. Paths
		// marked seen before this was tracked map to an empty string.
		getSeenSignatures(repoId: string, contextKey: string): Promise<Record<string, string>>;
		// Given the diff signatures (`<base>..<dst>` blob-OID pairs) of the files
		// shown in `contextKey`, return the paths whose identical diff was already
		// marked seen under a *different* context for the same repo. Lets a file
		// reviewed in one tab (e.g. unstaged) count as seen in another (e.g. the
		// branch) when the change is byte-for-byte the same. Only `oid:`-form
		// signatures match; stat fallbacks never carry across contexts.
		getInheritedSeen(
			repoId: string,
			contextKey: string,
			fileDiffSigs: Record<string, string>
		): Promise<string[]>;
		// Given the fresh diff signatures of the files shown in `contextKey`, return
		// the paths whose mark should be *kept* even though their diff changed,
		// because a chain of reviewed diffs (this context's prior reviewed state plus
		// other contexts') still spans the new diff. Rolls their stored signature
		// forward. Called before the unmark-on-change pass so it can override it for
		// files the reviewer has, in effect, already seen end to end.
		getRetainedSeen(
			repoId: string,
			contextKey: string,
			fileDiffSigs: Record<string, string>
		): Promise<string[]>;
		// `sig` is the file's content signature at mark-seen time; stored alongside
		// the seen mark so a later change can be detected. Omitted when un-seeing.
		setFileSeen(
			repoId: string,
			contextKey: string,
			filePath: string,
			seen: boolean,
			sig?: string
		): Promise<void>;
		clearSeen(repoId: string, contextKey: string): Promise<void>;
		getCollapsedFiles(repoId: string, contextKey: string): Promise<string[]>;
		setFileCollapsed(
			repoId: string,
			contextKey: string,
			filePath: string,
			collapsed: boolean
		): Promise<void>;
		// Collapse/expand many files at once (one persisted write), used by the
		// sidebar's "Collapse all seen" button.
		setFilesCollapsed(
			repoId: string,
			contextKey: string,
			filePaths: string[],
			collapsed: boolean
		): Promise<void>;
		clearCollapsedFiles(repoId: string, contextKey: string): Promise<void>;
		// The last-computed changed-file list for a context, persisted so a cold
		// start can paint the sidebar (with seen markers) instantly while the git
		// diff revalidates in the background. Empty array if none is cached.
		getCachedFileList(repoId: string, contextKey: string): Promise<ChangedFile[]>;
		setCachedFileList(repoId: string, contextKey: string, files: ChangedFile[]): Promise<void>;
		// The non-default base ref the Branch diff last used for a checked-out
		// branch (a pinned `pr/<n>/base`), remembered so a cold start targets it
		// from the first paint instead of flipping off the local default branch
		// once the async PR lookup lands. Null when none was remembered.
		getBranchBase(repoId: string, branch: string): Promise<string | null>;
		setBranchBase(repoId: string, branch: string, base: string | null): Promise<void>;
		getCommitDraft(repoId: string): Promise<CommitDraft>;
		setCommitDraft(repoId: string, draft: CommitDraft): Promise<void>;
	};
	// Local usage statistics. All counters are stored on disk per repo; nothing is
	// sent anywhere. Counts that need de-duplication (files by content, sessions by
	// id) are recorded with the dedup key so re-marking the same thing never
	// inflates the totals; the rest are bumped server-side from their own handlers.
	stats: {
		// The display-ready stats for one repo (zeroed when none recorded yet).
		get(repoId: string): Promise<RepoUsageStats>;
		// Every repo's stats keyed by repoId, for the aggregate roll-up + breakdown.
		getAll(): Promise<Record<string, RepoUsageStats>>;
		// Record a file marked seen: `sig` is its content signature (deduped against
		// every sig ever reviewed in the repo) and `loc` its additions + deletions,
		// added to the LOC total only the first time that content is seen.
		recordFileReviewed(repoId: string, sig: string, loc: number): Promise<void>;
		// Record a guided-tour session opened, deduped by session id.
		recordSessionReviewed(repoId: string, sessionId: string): Promise<void>;
	};
	icons: {
		// Resolve a custom-icon source to an `<img>`-ready src. `https:`/`data:`
		// sources pass through unchanged; an absolute local path is read and
		// returned as a `data:` URI. Returns null when the path can't be read or
		// isn't a supported image, so the renderer can fall back to the language
		// icon.
		resolveCustomIcon(source: string): Promise<string | null>;
		// Open the native file picker (filtered to supported image types) so the
		// user can choose a local icon. Resolves to the chosen absolute path, or
		// null if they cancel.
		pickIconFile(): Promise<string | null>;
	};
	sessions: {
		// A `ref` (a branch name or fetched PR head ref) reads the sessions
		// committed on that ref — the branch/PR being reviewed read-only — instead
		// of the working tree on disk. Null/omitted reads disk (the checked-out
		// branch, picking up an agent's not-yet-committed CLI saves).
		list(repoId: string, ref?: string | null): Promise<SessionSummary[]>;
		get(repoId: string, id: string, ref?: string | null): Promise<Session | null>;
		remove(repoId: string, id: string): Promise<void>;
		// Delete every session for the repo (the pre-merge purge).
		clear(repoId: string): Promise<void>;
		// Cheap count of the repo's sessions (drives the tab badge). A `ref` counts
		// the sessions committed on that ref (a read-only branch/PR view).
		count(repoId: string, ref?: string | null): Promise<number>;
		// Start/stop live updates for this window's active repo. The main process
		// fs-watches the repo's .super-review/sessions dir and emits
		// `onSessionsChanged`; pass null (or call unwatch) to stop.
		watch(repoId: string | null): Promise<void>;
		unwatch(): Promise<void>;
	};
	comments: {
		// Local review comments for a single diff context (`diffContextKey(ctx)`),
		// read from the repo's git-ignored SQLite database.
		list(repoId: string, contextKey: string): Promise<LocalComment[]>;
		// Create a comment (id + timestamps assigned by the main process) and return
		// the persisted record.
		add(repoId: string, input: NewLocalCommentInput): Promise<LocalComment>;
		// Replace a comment's body (and bump `updatedAt`). Returns the updated
		// comment, or null if it's gone.
		edit(repoId: string, id: string, body: string): Promise<LocalComment | null>;
		// Stamp `resolvedAt`/`resolvedBy` (and optionally link a session that
		// addressed the feedback). Returns the updated comment, or null if it's gone.
		resolve(
			repoId: string,
			id: string,
			resolver: LocalCommentAuthor,
			sessionId?: string | null
		): Promise<LocalComment | null>;
		// Clear resolution. Returns the updated comment, or null if it's gone.
		unresolve(repoId: string, id: string): Promise<LocalComment | null>;
		remove(repoId: string, id: string): Promise<void>;
		// Start/stop live updates for this window's active repo. The main process
		// fs-watches the repo's .super-review/comments dir and emits
		// `onCommentsChanged`; pass null (or call unwatch) to stop.
		watch(repoId: string | null): Promise<void>;
		unwatch(): Promise<void>;
	};
	tasks: {
		// A branch's task list. A `ref` (branch name or fetched PR head ref) reads
		// the list committed on that ref — the branch/PR reviewed read-only —
		// instead of the working tree. Null/omitted reads disk.
		list(repoId: string, branch: string, ref?: string | null): Promise<Task[]>;
		// Append a task (id/order/timestamps + `createdBy` assigned by the store).
		add(repoId: string, branch: string, input: NewTaskInput): Promise<Task>;
		// Edit a task's title/notes/order. Returns the updated task, or null if gone.
		update(repoId: string, branch: string, id: string, patch: TaskPatch): Promise<Task | null>;
		// Check a task off (or reopen it), recording who did it in `doneBy`/`doneAt`
		// on check and clearing them on uncheck. Returns the updated task, or null.
		setDone(
			repoId: string,
			branch: string,
			id: string,
			done: boolean,
			actor: TaskActor
		): Promise<Task | null>;
		remove(repoId: string, branch: string, id: string): Promise<void>;
		// Reorder the branch's tasks to match `ids`.
		reorder(repoId: string, branch: string, ids: string[]): Promise<void>;
		// Delete the branch's entire task list.
		clear(repoId: string, branch: string): Promise<void>;
		// Start/stop live updates for this window's active repo. The main process
		// fs-watches the repo's .super-review/tasks dir and emits `onTasksChanged`;
		// pass null (or call unwatch) to stop.
		watch(repoId: string | null): Promise<void>;
		unwatch(): Promise<void>;
	};
	aiConfig: {
		// Detect which AI files (skill + tour-author subagent) are configured for
		// the repo across every target and scope, so the Configure dialog can
		// reflect current state and the notices know whether anything is installed.
		status(repoId: string): Promise<AiConfigStatus>;
		// Write the selected skill/subagent files to the chosen targets and scopes.
		// Each item is reported independently so one failed write doesn't abort the
		// rest.
		apply(repoId: string, request: AiConfigApplyRequest): Promise<AiConfigApplyResult>;
		// Delete one installed skill (directory) or subagent (file) from disk. The
		// target/artifact/scope resolves to a known location in the main process, so
		// the renderer can never ask to delete an arbitrary path.
		remove(repoId: string, item: AiConfigInstallItem): Promise<AiConfigRemoveResult>;
	};
	commitMessage: {
		// Which supported harness CLIs are installed, on PATH, and signed in.
		// Auth answers are cached for a minute; `force` throws that away, for when
		// the user has just signed a CLI in and come back.
		detect(force?: boolean): Promise<CommitMessageHarnessStatus>;
		// Generate a commit subject + body via the preferred (or first available)
		// harness CLI, locked down to text-only. Uses the checked-file selections
		// the commit box would include. Progress streams via events.onCommitMessageProgress.
		generate(
			repoId: string,
			request: GenerateCommitMessageRequest
		): Promise<GenerateCommitMessageResult>;
		// Abort the in-flight generation, if any.
		cancel(): Promise<boolean>;
		// Models available for a harness (CLI listing when possible, curated fallback).
		listModels(harness: CommitMessageHarness): Promise<CommitMessageModelOption[]>;
	};
	npm: {
		// Fetch trimmed npm-registry metadata for a package, for the package.json
		// hover cards. Cached in the main process; resolves to an error variant
		// rather than rejecting so the card can render the failure inline.
		getPackageInfo(name: string): Promise<NpmPackageResult>;
		// Fetch the GitHub release notes for a package version, for the hover card's
		// "What's new" disclosure. `repositoryUrl` is the package's normalized repo
		// URL and `packageName` lets monorepos be matched by their `name@version`
		// tag. Resolves `{ release: null }` when it isn't a GitHub repo or has no
		// matching release, and an error variant rather than rejecting.
		getReleaseNotes(
			repositoryUrl: string,
			packageName: string,
			version: string
		): Promise<ReleaseNotesResult>;
		// Fetch the GitHub release notes for every release between two versions
		// (exclusive of the lower, inclusive of the higher), for when a dependency's
		// version changed in the diff. Order of the args doesn't matter; the result
		// is newest-first.
		getReleaseNotesRange(
			repositoryUrl: string,
			packageName: string,
			fromVersion: string,
			toVersion: string
		): Promise<ReleaseNotesRangeResult>;
	};
	feedback: {
		// Send feedback to the Super Review backend. No GitHub account or license
		// is required; the device token is attached when there is one, purely so
		// the report can be attributed. App version + OS are added in the main
		// process. Rejects with a readable message the dialog shows inline.
		submit(input: FeedbackInput): Promise<FeedbackResult>;
	};
	shell: {
		openExternal(url: string): Promise<void>;
		// Reveal a file in the OS file manager (Finder / Explorer), selecting it.
		showItemInFolder(fullPath: string): Promise<void>;
		// Open a file with the OS default program for its type.
		openPath(fullPath: string): Promise<{ ok: boolean; error?: string }>;
	};
	// The single, human-editable settings.json dotfile that holds every shareable
	// preference (the live source of truth). Backs the "Settings file" panel.
	settings: {
		// Absolute path to settings.json (shown in the UI, used for reveal).
		getPath(): Promise<string>;
		// Reveal settings.json in the OS file manager.
		reveal(): Promise<void>;
		// Open settings.json in the configured external editor, or the OS default
		// handler when none is set.
		openInEditor(): Promise<{ ok: boolean; error?: string }>;
		// Any malformed/reset issue seen the first time settings.json loaded this
		// session, read-once (cleared by the call) for a one-time startup warning.
		getStartupIssues(): Promise<{ malformed: boolean; reset: string[] }>;
		// Save a copy of the current settings to a user-chosen path (Save dialog).
		export(): Promise<{ ok: boolean; canceled: boolean; path?: string; error?: string }>;
		// Load a settings file the user picks (Open dialog), validate it, and make
		// it the new settings. `reset` lists any fields that were invalid.
		import(): Promise<{
			ok: boolean;
			canceled: boolean;
			reset?: string[];
			prefs?: UserPrefs;
			error?: string;
		}>;
		// Reset every settings.json-owned preference to its default (state untouched).
		reset(): Promise<UserPrefs>;
	};
	menu: {
		// Pop up a native OS context menu for a file row. Resolves to the chosen
		// action, or null when the menu is dismissed without a selection.
		showFileContextMenu(params: FileContextMenuParams): Promise<FileContextMenuResult | null>;
		// Pop up a native OS context menu for a changed diff line. Resolves to the
		// chosen action, or null when the menu is dismissed without a selection.
		showDiffLineContextMenu(
			params: DiffLineContextMenuParams
		): Promise<DiffLineContextMenuAction | null>;
		// Pop up a native OS context menu for a branch row. Resolves to the chosen
		// action, or null when the menu is dismissed without a selection.
		showBranchContextMenu(params: BranchContextMenuParams): Promise<BranchContextMenuAction | null>;
		// Pop up a native OS context menu for a pull-request row. Resolves to the
		// chosen action, or null when the menu is dismissed without a selection.
		showPRContextMenu(params: PRContextMenuParams): Promise<PRContextMenuAction | null>;
		// Pop up a native OS context menu for a task row in the Tasks tab. Resolves
		// to the chosen action, or null when the menu is dismissed.
		showTaskContextMenu(params: TaskContextMenuParams): Promise<TaskContextMenuAction | null>;
		// Pop up a native OS context menu for a repo row in the picker. Resolves to
		// the chosen action, or null when the menu is dismissed without a selection.
		showRepoContextMenu(params: RepoContextMenuParams): Promise<RepoContextMenuAction | null>;
		// Pop up a native OS context menu for a commit row in the history list.
		// Resolves to the chosen action, or null when the menu is dismissed.
		showCommitContextMenu(): Promise<CommitContextMenuAction | null>;
		// Pop up the header's "Show in header" customization context menu. Resolves
		// to the toggled item and its new state, or null when dismissed.
		showHeaderContextMenu(params: HeaderContextMenuParams): Promise<HeaderContextMenuResult>;
		// Pop up the empty view's "Show on this screen" customization context menu.
		// Resolves to the toggled item and its new state, or null when dismissed.
		showEmptyViewContextMenu(
			params: EmptyViewContextMenuParams
		): Promise<EmptyViewContextMenuResult>;
		// Pop up the sidebar tab strip's "Show tab" customization context menu.
		// Resolves to the toggled tab and its new state, or null when dismissed.
		showTabsContextMenu(params: TabsContextMenuParams): Promise<TabsContextMenuResult>;
		// Pop up the sidebar controls row's "Show button" customization context menu.
		// Resolves to the toggled button and its new state, or null when dismissed.
		showSidebarControlsContextMenu(
			params: SidebarControlsContextMenuParams
		): Promise<SidebarControlsContextMenuResult>;
		// Pop up a diff file header's "Show in file header" customization context
		// menu. Resolves to the toggled item and its new state, or null when dismissed.
		showFileHeaderContextMenu(
			params: FileHeaderContextMenuParams
		): Promise<FileHeaderContextMenuResult>;
		// Push the latest Branch-menu enablement/labels to the main process so it
		// can rebuild the native application menu. Fire-and-forget.
		setBranchState(state: BranchMenuState): void;
		// Push the latest Repository-menu enablement/labels to the main process.
		setRepositoryState(state: RepositoryMenuState): void;
	};
	windowControls: {
		// Re-center the macOS traffic lights for the renderer's current zoom factor.
		sync(): void;
		// Run a role-menu / window-chrome action (edit, view, window, quit). Used by
		// the Windows HTML AppMenuBar; macOS keeps the native menu bar.
		perform(action: WindowChromeAction): Promise<void>;
	};
	events: {
		onRepoChanged(handler: (repo: RepoInfo | null) => void): () => void;
		// A native "Branch" menu item was chosen. Returns an unsubscribe fn.
		onBranchMenuAction(handler: (action: BranchMenuAction) => void): () => void;
		// A native "Repository" menu item was chosen. Returns an unsubscribe fn.
		onRepositoryMenuAction(handler: (action: RepositoryMenuAction) => void): () => void;
		// A native "Help" menu item was chosen (e.g. Send Feedback). Returns an
		// unsubscribe fn.
		onHelpMenuAction(handler: (action: HelpMenuAction) => void): () => void;
		// A background "move to Trash" (after removing a repo) failed; the payload
		// is the repo's name. Returns an unsubscribe fn.
		onRepoTrashFailed(handler: (name: string) => void): () => void;
		// A repo's sessions changed on disk (manifest written/removed by the CLI or
		// another window). Payload is the repo id. Returns an unsubscribe fn.
		onSessionsChanged(handler: (repoId: string) => void): () => void;
		// A repo's local comments changed on disk (added in another window, or an
		// agent resolved one via the CLI). Payload is the repo id. Returns an
		// unsubscribe fn.
		onCommentsChanged(handler: (repoId: string) => void): () => void;
		// A repo's branch tasks changed on disk (edited in another window, or by an
		// agent via the CLI). Payload is the repo id. Returns an unsubscribe fn.
		onTasksChanged(handler: (repoId: string) => void): () => void;
		// An account's GitHub token started or stopped failing authentication.
		// Payload is the full current list of failing accounts (empty = all good).
		// Returns an unsubscribe fn.
		onGithubAuthChanged(handler: (errors: GithubAuthError[]) => void): () => void;
		// Live license-state changes pushed by the main process (activation
		// completes, revalidation flips status, etc.). Returns an unsubscribe fn.
		onLicenseChanged(handler: (state: LicenseState) => void): () => void;
		// Live prefs changes pushed by the main process: settings.json edited
		// externally, or a settings file imported/reset. Returns an unsubscribe fn.
		onPrefsChanged(handler: (change: PrefsChange) => void): () => void;
		// Streaming text while commit-message generation runs. Returns an unsubscribe fn.
		onCommitMessageProgress(handler: (event: CommitMessageProgressEvent) => void): () => void;
		// What the agent is doing while it writes the branch's changesets. Returns an
		// unsubscribe fn.
		onChangesetProgress(handler: (event: ChangesetProgressEvent) => void): () => void;
		// Background auto-update progress pushed by the main process (checking →
		// downloading → downloaded, or error). Returns an unsubscribe fn.
		onUpdateStatus(handler: (status: UpdateStatus) => void): () => void;
	};
}

declare global {
	interface Window {
		api: PreloadAPI;
	}
}
