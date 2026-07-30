<script lang="ts">
	import { mount, unmount, onDestroy, untrack } from 'svelte';
	import { isMarkdownPath, renderMarkdown } from '@super-review/ui/markdown';
	import { isImagePath, isSvgPath } from '@super-review/core/media';
	import ImageDiff from './ImageDiff.svelte';
	import DiffFileHeader from './DiffFileHeader.svelte';
	import '@super-review/ui/markdown.css';
	import {
		DIFFS_TAG_NAME,
		File as FileClass,
		FileDiff as FileDiffClass,
		parseDiffFromFile,
		type DiffLineAnnotation,
		type DiffTokenEventBaseProps,
		type FileContents,
		type FileDiffMetadata,
		type HunkExpansionRegion,
		type OnDiffLineClickProps,
		type SelectedLineRange
	} from '@pierre/diffs';
	import { Button } from './ui/button';
	import { formatHotkeyParts } from '@super-review/core/hotkeys';
	import {
		actions,
		app,
		composerKey,
		getCachedDiff,
		isReadOnlyView,
		setCachedDiff
	} from '@super-review/ui/store.svelte';
	import { diffDeferReason } from '@super-review/core/diff-defer';
	import {
		sessionIdFromManifestPath,
		isTaskManifestPath
	} from '@super-review/core/session-manifest';
	import { getDiffWorkerPool } from '@super-review/ui/diff-worker-pool';
	import { scheduleRender } from '@super-review/ui/render-scheduler';
	import {
		applyIndentGuides,
		clearIndentGuides,
		detectIndentStep
	} from '@super-review/ui/diff-indent-guides';
	import { diffContextKey } from '@super-review/core/diff-context';
	import {
		changedLineKeys,
		parseFilePatch,
		stagingLineKey,
		type DiffSide
	} from '@super-review/core/diff-staging';
	import { registerFindSection, notifySectionState } from '@super-review/ui/diff-find.svelte';
	import {
		isPackageJsonPath,
		parsePackageDeps,
		spanAt,
		versionForName,
		type PackageDepIndex
	} from '@super-review/ui/package-json-deps';
	import {
		showPackageHover,
		scheduleHidePackageHover
	} from '@super-review/ui/package-hover.svelte';
	import CommentAnnotation, { type CommentMeta } from './CommentAnnotation.svelte';
	import LocalCommentAnnotation, { type LocalCommentMeta } from './LocalCommentAnnotation.svelte';
	import CalloutAnnotation from './CalloutAnnotation.svelte';
	import SessionDiffCard from './SessionDiffCard.svelte';
	import TaskDiffCard from './TaskDiffCard.svelte';
	import { calloutsForFile } from '@super-review/ui/session-tour';
	import { localCommentOutdated } from '@super-review/ui/comment-outdated';
	import type {
		ChangedFile,
		DiffContext,
		DiffData,
		FileHeaderItemVisibility,
		LocalComment,
		PRReviewComment,
		SessionCallout
	} from '@super-review/core/types';

	// Metadata Pierre carries on each line annotation. PR review comments/composers
	// use CommentMeta; local review comments/composers use LocalCommentMeta; agent
	// tour callouts add another variant. renderAnnotation branches on `kind` to
	// mount the right component.
	type CalloutMeta = { kind: 'callout'; callout: SessionCallout };
	type AnnotationMeta = CommentMeta | LocalCommentMeta | CalloutMeta;

	interface Props {
		file: ChangedFile;
		observer: IntersectionObserver | null;
		// When true, this section is given `min-height: 100%` of the scroll
		// container so the last file can scroll its top to the viewport top
		// without exposing scrollable area past its own bottom.
		isLast?: boolean;
		// When true, the section treats itself as in view immediately and skips the
		// IntersectionObserver. Used by the single-file diff layout, where the only
		// rendered section is always on screen and should fetch/render right away
		// rather than flashing a "Scroll to load" placeholder.
		eager?: boolean;
	}

	let { file, observer, isLast = false, eager = false }: Props = $props();

	let section = $state<HTMLElement | null>(null);
	let host = $state<HTMLElement | null>(null);
	let diffContainer: HTMLElement | null = null;
	let instance: FileDiffClass<AnnotationMeta> | null = null;
	// Pierre's single-file renderer, used for the "Raw" view (the whole file with
	// no diff). Mutually exclusive with `instance`: only one is ever live at a
	// time (renderDiff picks the branch), and both share `diffContainer`/`host`.
	// Plain `let` (not $state) like `instance` — see the theme effect's caveat.
	let rawInstance: FileClass | null = null;
	// Diff/Raw toggle. When true the section renders the whole file (Pierre's
	// File renderer) instead of the diff — the "Raw" view. Part of the render
	// key, so flipping it re-renders through the normal scheduler. Reset
	// alongside `showPreview` when a recycled section is pointed at a new file.
	let showRaw = $state(false);
	// The annotation list currently painted into `instance`. The `lineAnnotations`
	// derived reads the *whole* `app.pendingComposers` object, so opening a
	// composer on ANY file re-runs the derived (and the update effect) on EVERY
	// mounted section — and each run hands back a fresh array. We diff against
	// this snapshot so only the sections whose annotations actually changed pay
	// for Pierre's expensive `rerender()`; the rest bail out early.
	let appliedAnnotations: DiffLineAnnotation<AnnotationMeta>[] = [];
	// Cache of mounted CommentAnnotation instances, keyed by annotation index.
	// FileDiff caches its wrapper element per annotation; we mount our component
	// once and let its $derived expressions react to store changes. Instance-
	// scoped imperative cache — intentionally a plain Map, not reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const mountedComponents = new Map<string, ReturnType<typeof mount>>();
	// Live DOM containers for rendered callout notes, keyed by callout id, so a
	// "scroll to callout" request can align the note into view even though it
	// lives inside the diff's DOM. Repopulated on every render. Instance-scoped
	// imperative cache — intentionally a plain Map, not reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const calloutContainers = new Map<string, HTMLElement>();
	// Same, for local-comment annotations, so the right sidebar's "scroll to
	// comment" can align a comment into view.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const commentContainers = new Map<string, HTMLElement>();
	let cancelCalloutScroll: (() => void) | null = null;
	let diffData = $state<DiffData | null>(null);
	// Context key the current `diffData` was loaded for. When the user switches
	// tabs and the {#each} reuses this component (because the file exists in
	// both contexts), this lets us detect the stale render and refetch.
	let loadedCtxKey = $state<string | null>(null);
	// Bumped every time `diffData` is replaced so the render effect notices new
	// content even when the context key stays the same (e.g. cached → fresh).
	let dataEpoch = $state(0);
	// `${ctxKey}::${viewMode}::${epoch}` of what's currently in the DOM. Diverges
	// from `targetRenderKey` whenever a render is pending or needed.
	let renderedKey = $state<string | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let inView = $state(false);
	const expanded = $derived(!app.collapsedFiles.has(file.path));
	// Set true when the user clicks "Load diff" to override the default hiding
	// of matched / oversized diffs. Resets to false if the file changes.
	let loadDiffOverride = $state(false);
	// Why this diff is hidden by default (matched a hidden pattern or too large),
	// or null when it should render normally. The override forces a render.
	const deferReason = $derived(
		loadDiffOverride ? null : diffDeferReason(file, app.maxDiffLines, app.hiddenDiffPatterns)
	);
	const deferred = $derived(deferReason !== null);
	// When a deferred file is a `.super-review/sessions/*.json` manifest, the raw
	// JSON diff is useless to a reviewer — show a card that opens the documented
	// session instead. Null for any other file, and skipped when the manifest is
	// being deleted: that session no longer exists, so a card would link nowhere.
	const sessionManifestId = $derived(
		file.status === 'deleted' ? null : sessionIdFromManifestPath(file.path)
	);
	// A `.super-review/tasks/*.json` branch task list renders as a checklist card
	// rather than raw JSON, mirroring the session manifest above. Skipped for a
	// delete: the list is gone, so there is nothing to render.
	const taskManifest = $derived(file.status !== 'deleted' && isTaskManifestPath(file.path));
	// The pre-rename path, when this is a rename/copy that actually moved. Git
	// occasionally reports a rename whose old and new paths match (e.g. a
	// case-only change on a case-insensitive FS round-tripped) — guard against
	// it so we don't render a pointless `foo → foo`.
	const renameFrom = $derived(
		(file.status === 'renamed' || file.status === 'copied') &&
			file.oldPath &&
			file.oldPath !== file.path
			? file.oldPath
			: null
	);
	// Image files are rendered side by side (raster) or get a code/image toggle
	// (SVG), so the usual "no content changes" one-liner doesn't apply — we still
	// want to show the old image of a deleted image, etc.
	const isImage = $derived(isImagePath(file.path));
	const isSvg = $derived(isSvgPath(file.path));
	// Files with a git change but no textual diff (mode-only, pure rename/copy,
	// type-change, empty add) — skip the fetch and show a one-liner, matching
	// GitHub Desktop. A deletion with real content is NOT one of these: like
	// GitHub, we render the old file as an all-removed diff rather than a
	// placeholder. Images keep their side-by-side view; binaries have their own
	// message after load.
	const noContentChanges = $derived(
		!isImage && !file.isBinary && file.additions === 0 && file.deletions === 0
	);
	// Set when a fetched diff turns out to have identical sides despite non-zero
	// stats (rare), so we still show the empty-state instead of a blank host.
	let identicalSides = $state(false);
	const placeholderMessage = $derived(
		noContentChanges || identicalSides ? 'No content changes found.' : null
	);

	// Partial (line/hunk) staging is offered only in the Unstaged working-tree
	// tab, and only for files with a real git patch to carve up — modified
	// tracked files. Added/untracked (no HEAD patch), deletions, renames-with-no-
	// changes and binaries fall back to the whole-file checkbox in the sidebar.
	const stagingEnabled = $derived(
		app.contextTab === 'unstaged' &&
			app.diffContext.kind === 'workingTree' &&
			!file.isBinary &&
			file.status !== 'deleted'
	);
	// Staging model for the loaded diff: every changed-line key in the file,
	// derived from the raw git patch. Used to reconcile per-line/section toggles
	// with the whole-file checkbox (see store.setLinesIncludedForCommit). Sections
	// themselves are derived from the rendered DOM, not from here. Null when
	// staging isn't offered or there's no filterable patch. Plain (non-reactive):
	// rebuilt by renderDiff and read by the imperative gutter-control code.
	interface StagingModel {
		allKeys: string[];
	}
	let staging: StagingModel | null = null;
	// The shadow root the staging click listener is currently bound to. Pierre
	// recreates the diff (and its shadow root) on every render, so we rebind.
	let stagingClickRoot: ShadowRoot | null = null;
	// Handle for the most recently queued render so we can cancel it if a newer
	// target supersedes it before the scheduler gets to it.
	let cancelPendingRender: (() => void) | null = null;

	// ----------------------------------------------------------------------
	// package.json hover cards. For a package.json diff we index each side's
	// dependency entries (name + version, with their character ranges) up front,
	// then map Pierre's token hover events onto them to drive a shared npm info
	// card. Indexes are rebuilt per render and keyed by side: a token reports the
	// line number for its own side, so additions/context resolve against the new
	// contents and deletions against the old.
	// ----------------------------------------------------------------------
	const isPkgJson = $derived(isPackageJsonPath(file.path));
	// Non-reactive caches rebuilt in renderDiff; null until then (and for any
	// non-package.json file). eslint-disable-next-line is unnecessary — plain
	// fields, not Svelte state.
	let pkgDepsNew: PackageDepIndex | null = null;
	let pkgDepsOld: PackageDepIndex | null = null;

	// Pierre fires this for every token the pointer enters (mouse only). For a
	// dependency name/version token we open the card anchored to that token;
	// hovering anything else in the file dismisses it.
	function onTokenEnter(props: DiffTokenEventBaseProps): void {
		const index = props.side === 'deletions' ? pkgDepsOld : pkgDepsNew;
		if (!index) return;
		const span = spanAt(index, props.lineNumber, props.lineCharStart, props.lineCharEnd);
		if (!span) {
			scheduleHidePackageHover();
			return;
		}
		// Resolve the package's version on each side so the card can show a range
		// changelog when the version changed in the diff (null when added/removed).
		showPackageHover(props.tokenElement, {
			kind: span.kind,
			name: span.name,
			version: span.version,
			oldRange: pkgDepsOld ? versionForName(pkgDepsOld, span.name) : null,
			newRange: pkgDepsNew ? versionForName(pkgDepsNew, span.name) : null
		});
	}

	// Leaving a token starts the shared close timer; re-entering a dep token (or
	// moving onto the card) cancels it, so name→version moves don't flicker.
	function onTokenLeave(): void {
		scheduleHidePackageHover();
	}

	// Show comments / accept new ones only where the local diff matches what
	// GitHub thinks the PR contains:
	//   - `kind: 'pr'`: reviewing someone's PR (refs `pr/N/base...pr/N/head`).
	//   - Branch tab with an open PR for the current branch (base...head).
	// The Unstaged tab is intentionally excluded — its line numbers reflect
	// uncommitted changes and don't translate to anything on GitHub.
	// `branchPR` tracks the checked-out branch; while reviewing a *different*
	// branch or a PR read-only it doesn't correspond to the diff on screen, so
	// don't surface its comments here.
	const isPRContext = $derived(
		app.diffContext.kind === 'pr' ||
			(app.contextTab === 'branch' && app.branchPR != null && !isReadOnlyView())
	);

	// Local review comments render in every context except a PR's own diff — the
	// working tree, a branch diff (with or without a PR), a session's changes, a
	// stash. Their line numbers are anchored to whatever diff is on screen and
	// stored under that context's key.
	//
	// NOT the inverse of isPRContext: on the Branch tab both are true once a PR is
	// open, and the two sets render side by side. Local threads written before the
	// PR existed used to disappear the moment it was opened, which is exactly when
	// a reviewer still needs them. Authoring is still exclusive (see
	// onDiffLineNumberClick) — a new comment goes to the PR.
	const isLocalCommentContext = $derived(app.diffContext.kind !== 'pr');

	// Whether Pierre's gutter `+` affordance should be live: any context where a
	// click produces a comment (PR or local).
	const canComment = $derived(isPRContext || isLocalCommentContext);

	// Pierre's parsed diff metadata for the rendered file (set in renderDiff). Its
	// `hunks` drive the targeted expansion of collapsed regions around comments.
	let fileDiffMeta = $state<FileDiffMetadata | null>(null);

	// Comment anchors (file-relative line + side) for this file in the current
	// context. Both sources contribute — on the Branch tab with a PR open the two
	// coexist, and a collapsed region has to expand for either kind.
	const commentAnchors = $derived.by<Array<{ side: 'LEFT' | 'RIGHT'; line: number }>>(() => {
		const out: Array<{ side: 'LEFT' | 'RIGHT'; line: number }> = [];
		if (isPRContext) {
			for (const c of app.prComments[file.path] ?? []) {
				if (c.line != null) out.push({ side: c.side, line: c.line });
			}
		}
		if (isLocalCommentContext) {
			for (const c of app.localComments) {
				if (c.path === file.path) out.push({ side: c.side, line: c.startLine });
			}
		}
		return out;
	});

	// Build the `expandedHunks` map that reveals JUST enough of each collapsed gap
	// to show any comment anchored inside it — not the whole file. A comment on a
	// line already inside a rendered hunk needs nothing. Otherwise we find the gap
	// that contains the line (the collapsed region before some hunk, or the trailing
	// region after the last hunk) and expand from the nearer edge up to that line.
	// See @pierre/diffs `getExpandedRegion`: key `i` is the gap before hunk `i`
	// (`hunks.length` = trailing gap); `fromStart` reveals the top, `fromEnd` the
	// bottom (adjacent to the hunk).
	function computeExpandedHunks(
		meta: FileDiffMetadata | null,
		anchors: Array<{ side: 'LEFT' | 'RIGHT'; line: number }>
	): Map<number, HunkExpansionRegion> {
		// Plain Map handed to Pierre as a render option — not reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<number, HunkExpansionRegion>();
		if (!meta || meta.hunks.length === 0 || anchors.length === 0) return map;
		const hunks = meta.hunks;
		const startOf = (h: (typeof hunks)[number], isNew: boolean): number =>
			isNew ? h.additionStart : h.deletionStart;
		const countOf = (h: (typeof hunks)[number], isNew: boolean): number =>
			isNew ? h.additionCount : h.deletionCount;

		for (const { side, line } of anchors) {
			const isNew = side === 'RIGHT';
			// Already inside a rendered hunk (incl. its shown context)? Nothing to do.
			let inside = false;
			for (const h of hunks) {
				const s = startOf(h, isNew);
				if (line >= s && line <= s + countOf(h, isNew) - 1) {
					inside = true;
					break;
				}
			}
			if (inside) continue;

			const i = hunks.findIndex((h) => startOf(h, isNew) > line);
			if (i >= 0) {
				const h = hunks[i];
				const gapTop = startOf(h, isNew) - h.collapsedBefore;
				if (line < gapTop) continue; // belongs to an earlier hunk's range
				const fromEndNeeded = startOf(h, isNew) - line; // reveal up from the hunk
				const fromStartNeeded = line - gapTop + 1; // reveal down from the top
				const prev = map.get(i) ?? { fromStart: 0, fromEnd: 0 };
				if (fromEndNeeded <= fromStartNeeded) {
					map.set(i, { fromStart: prev.fromStart, fromEnd: Math.max(prev.fromEnd, fromEndNeeded) });
				} else {
					map.set(i, {
						fromStart: Math.max(prev.fromStart, fromStartNeeded),
						fromEnd: prev.fromEnd
					});
				}
			} else {
				// Past the last hunk → the trailing gap, keyed by `hunks.length`
				// (`fromEnd` is ignored there, so reveal from the top).
				const last = hunks[hunks.length - 1];
				const trailingStart = startOf(last, isNew) + countOf(last, isNew);
				const fromStartNeeded = line - trailingStart + 1;
				if (fromStartNeeded <= 0) continue;
				const key = hunks.length;
				const prev = map.get(key) ?? { fromStart: 0, fromEnd: 0 };
				map.set(key, { fromStart: Math.max(prev.fromStart, fromStartNeeded), fromEnd: 0 });
			}
		}
		return map;
	}

	const expandedHunksForComments = $derived(computeExpandedHunks(fileDiffMeta, commentAnchors));

	// Pierre has no `expandedHunks` option — expansion is imperative and
	// accumulative via `expandHunk(index, direction, count)`: 'up' adds to
	// `fromStart` (reveals the gap top), 'down' adds to `fromEnd` (reveals the
	// bottom, next to the hunk). We track the last-applied absolute regions and
	// push only the delta (which may be negative to shrink when a comment is
	// removed; Pierre clamps it).
	let appliedExpanded = new Map<number, HunkExpansionRegion>();
	function applyExpandedHunks(desired: Map<number, HunkExpansionRegion>, rerender: boolean): void {
		if (!instance) return;
		const indices = new Set<number>([...desired.keys(), ...appliedExpanded.keys()]);
		let changed = false;
		for (const i of indices) {
			const d = desired.get(i) ?? { fromStart: 0, fromEnd: 0 };
			const a = appliedExpanded.get(i) ?? { fromStart: 0, fromEnd: 0 };
			const dStart = d.fromStart - a.fromStart;
			const dEnd = d.fromEnd - a.fromEnd;
			if (dStart !== 0) {
				instance.expandHunk(i, 'up', dStart);
				changed = true;
			}
			if (dEnd !== 0) {
				instance.expandHunk(i, 'down', dEnd);
				changed = true;
			}
		}
		appliedExpanded = desired;
		if (changed && rerender) instance.rerender();
	}

	// Memoize the `metadata` objects we hand Pierre — its annotation cache uses
	// a reference check (`metadata === metadata`) to decide whether to re-render
	// an annotation. If we hand it a fresh `{ kind: 'composer', … }` literal each
	// pass, Pierre rebuilds the wrapper and our `mount()` re-creates the form,
	// which steals focus from the textarea. Keying these by stable identifiers
	// (comment id / composer key) gives Pierre the same ref every time. Each
	// cache is narrowed to a single variant so the discriminated union doesn't
	// confuse Pierre's `DiffLineAnnotation<T>` generic when we push.
	type CommentMetaComment = Extract<CommentMeta, { kind: 'comment' }>;
	type CommentMetaComposer = Extract<CommentMeta, { kind: 'composer' }>;
	type LocalMetaComment = Extract<LocalCommentMeta, { kind: 'local-comment' }>;
	type LocalMetaComposer = Extract<LocalCommentMeta, { kind: 'local-composer' }>;
	// Instance-scoped memo caches keyed by stable identifiers — intentionally
	// plain Maps: Pierre relies on reference-equality of these metadata objects
	// (see above), and they aren't reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const commentMetaCache = new Map<number, CommentMetaComment>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const composerMetaCache = new Map<string, CommentMetaComposer>();
	// Local-comment counterparts, keyed by comment id / composer key.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const localCommentMetaCache = new Map<string, LocalMetaComment>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const localComposerMetaCache = new Map<string, LocalMetaComposer>();
	// Same reference-stability trick for tour callouts, keyed by callout id.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const calloutMetaCache = new Map<string, CalloutMeta>();

	// Session tour callouts pinned to this file (empty outside a session). Read
	// reactively so the annotation list rebuilds when the open session changes.
	const fileCallouts = $derived(
		app.diffContext.kind === 'session' ? calloutsForFile(app.activeSessionDetail, file.path) : []
	);

	// Count the lines in a file's contents. A trailing newline terminates the last
	// line rather than starting an empty one, so it isn't counted; an empty file
	// has zero lines.
	function lineCount(contents: string): number {
		if (contents.length === 0) return 0;
		return contents.endsWith('\n') ? contents.split('\n').length - 1 : contents.split('\n').length;
	}

	// How many lines each side of this file currently has, from the full contents
	// the diff carries. A local comment is "outdated" when its anchored line no
	// longer exists in the file — i.e. the file is now shorter than that line, so
	// the code it sat on is gone — mirroring how GitHub flags PR comments whose
	// code has since changed. We judge against the whole file (not just the diff's
	// hunks): a comment placed on an unchanged line outside the changes — e.g. on
	// expanded context in the Unstaged view — is perfectly valid and must NOT be
	// flagged. Null until the diff is loaded, or when it's truncated (the line
	// counts can't be trusted), so the UI shows no badge rather than a false
	// positive. Only meaningful for local-comment contexts; PR contexts get
	// outdated straight from GitHub.
	const localFileExtent = $derived.by<{ left: number; right: number } | null>(() => {
		if (!isLocalCommentContext) return null;
		if (!diffData || diffData.truncated) return null;
		return { left: lineCount(diffData.oldContents), right: lineCount(diffData.newContents) };
	});

	// This file's local comments (empty outside a local-comment context).
	const fileLocalComments = $derived(
		isLocalCommentContext ? app.localComments.filter((c) => c.path === file.path) : []
	);

	// Reconcile this file's outdated comment ids into the shared store set, so the
	// comments sidebar can badge comments whose anchored line is gone — they no
	// longer render inline, so the sidebar is the only place they can surface.
	// Touches only this file's ids (file paths are unique across sections, so no
	// contention). A deleted file marks its RIGHT-side comments outdated straight
	// from `file.status` (no diff needed), so they badge even before the section is
	// scrolled into view to load its all-removed diff. Otherwise, while the diff is
	// unloaded (`localFileExtent` null) we can't tell, so we drop this file's ids
	// rather than guess. Cleaned up on destroy.
	$effect(() => {
		const extent = localFileExtent;
		const fileDeleted = file.status === 'deleted';
		for (const c of fileLocalComments) {
			if (localCommentOutdated(c, { fileDeleted, extent })) app.outdatedLocalCommentIds.add(c.id);
			else app.outdatedLocalCommentIds.delete(c.id);
		}
	});
	onDestroy(() => {
		for (const c of fileLocalComments) app.outdatedLocalCommentIds.delete(c.id);
	});

	// Build the annotation list FileDiff renders: PR comments + pending composers
	// (PR contexts only), plus agent tour callouts (session context). Annotation
	// order is part of the cache key — `${index}-${side}-${line}` — so we append
	// deterministically (comments, composers, then callouts) for stable identity.
	const lineAnnotations = $derived.by<DiffLineAnnotation<AnnotationMeta>[]>(() => {
		const out: DiffLineAnnotation<AnnotationMeta>[] = [];

		const comments = isPRContext ? (app.prComments[file.path] ?? []) : [];
		const composers = isPRContext
			? Object.values(app.pendingComposers).filter((composer) => composer.filePath === file.path)
			: [];
		const localComments: LocalComment[] = isLocalCommentContext
			? app.localComments.filter((c) => c.path === file.path)
			: [];
		const localComposers = isLocalCommentContext
			? Object.values(app.localComposers).filter((composer) => composer.filePath === file.path)
			: [];
		// Built functionally (no in-place mutation) so they stay ordinary,
		// non-reactive Sets — scratch for the cache GC below, not reactive state.
		const liveCommentIds = new Set(comments.filter((c) => c.line != null).map((c) => c.id));
		const liveComposerKeys = new Set(
			composers.map((composer) => composerKey(composer.filePath, composer.side, composer.line))
		);
		const liveLocalCommentIds = new Set(localComments.map((c) => c.id));
		const liveLocalComposerKeys = new Set(
			localComposers.map((composer) => composerKey(composer.filePath, composer.side, composer.line))
		);
		const liveCalloutIds = new Set(fileCallouts.map((callout) => callout.id));

		for (const c of comments) {
			if (c.line == null) continue;
			let meta = commentMetaCache.get(c.id);
			// Invalidate the cached metadata if the underlying comment object was
			// replaced (e.g. server returned an edited copy).
			if (meta == null || meta.comment !== c) {
				meta = { kind: 'comment', comment: c };
				commentMetaCache.set(c.id, meta);
			}
			out.push({
				side: c.side === 'LEFT' ? 'deletions' : 'additions',
				lineNumber: c.line,
				metadata: meta
			});
		}

		for (const composer of composers) {
			const key = composerKey(composer.filePath, composer.side, composer.line);
			let meta = composerMetaCache.get(key);
			if (meta == null || meta.replyTo !== composer.replyTo) {
				meta = {
					kind: 'composer',
					filePath: composer.filePath,
					line: composer.line,
					side: composer.side,
					replyTo: composer.replyTo
				};
				composerMetaCache.set(key, meta);
			}
			out.push({
				side: composer.side === 'LEFT' ? 'deletions' : 'additions',
				lineNumber: composer.line,
				metadata: meta
			});
		}

		// Order so each thread's root leads and its replies follow (createdAt asc),
		// threads ordered by their root's createdAt. Replies share the root's line, so
		// Pierre stacks same-line annotations in array order — emitting root-then-reply
		// here is what puts a reply directly *under* its root rather than above it.
		// A plain object lookup (not a Map) keeps this out of the reactive-collection
		// lint and is pure scratch for the sort.
		const createdById: Record<string, number> = {};
		for (const c of localComments) createdById[c.id] = c.createdAt;
		const rootCreatedAt = (c: LocalComment): number =>
			createdById[c.inReplyTo ?? c.id] ?? c.createdAt;
		const orderedLocalComments = [...localComments].sort((a, b) => {
			const ra = rootCreatedAt(a);
			const rb = rootCreatedAt(b);
			if (ra !== rb) return ra - rb;
			const rootA = a.inReplyTo ?? a.id;
			const rootB = b.inReplyTo ?? b.id;
			if (rootA === rootB) {
				// Same thread: root (no inReplyTo) first, then replies by createdAt.
				const aReply = a.inReplyTo != null ? 1 : 0;
				const bReply = b.inReplyTo != null ? 1 : 0;
				return aReply !== bReply ? aReply - bReply : a.createdAt - b.createdAt;
			}
			return rootA < rootB ? -1 : 1;
		});

		for (const c of orderedLocalComments) {
			// undefined while the diff is still loading (don't claim outdated yet);
			// otherwise true when the anchored line no longer exists in the file (a
			// deleted file takes its RIGHT-side comments straight from the status).
			const outdated = localCommentOutdated(c, {
				fileDeleted: file.status === 'deleted',
				extent: localFileExtent
			});
			let meta = localCommentMetaCache.get(c.id);
			// Invalidate when the comment object was replaced (e.g. resolved) or its
			// outdated status changed (the diff shifted under it).
			if (meta == null || meta.comment !== c || meta.isOutdated !== outdated) {
				meta = { kind: 'local-comment', comment: c, isOutdated: outdated };
				localCommentMetaCache.set(c.id, meta);
			}
			out.push({
				side: c.side === 'LEFT' ? 'deletions' : 'additions',
				lineNumber: c.startLine,
				metadata: meta
			});
		}

		for (const composer of localComposers) {
			const key = composerKey(composer.filePath, composer.side, composer.line);
			let meta = localComposerMetaCache.get(key);
			if (meta == null) {
				meta = {
					kind: 'local-composer',
					filePath: composer.filePath,
					line: composer.line,
					side: composer.side
				};
				localComposerMetaCache.set(key, meta);
			}
			out.push({
				side: composer.side === 'LEFT' ? 'deletions' : 'additions',
				lineNumber: composer.line,
				metadata: meta
			});
		}

		for (const callout of fileCallouts) {
			let meta = calloutMetaCache.get(callout.id);
			if (meta == null || meta.callout !== callout) {
				meta = { kind: 'callout', callout };
				calloutMetaCache.set(callout.id, meta);
			}
			out.push({
				side: callout.side === 'old' ? 'deletions' : 'additions',
				lineNumber: callout.startLine,
				metadata: meta
			});
		}

		// Garbage-collect stale entries so the caches don't leak across the
		// lifetime of the section.
		for (const id of [...commentMetaCache.keys()]) {
			if (!liveCommentIds.has(id)) commentMetaCache.delete(id);
		}
		for (const k of [...composerMetaCache.keys()]) {
			if (!liveComposerKeys.has(k)) composerMetaCache.delete(k);
		}
		for (const id of [...localCommentMetaCache.keys()]) {
			if (!liveLocalCommentIds.has(id)) localCommentMetaCache.delete(id);
		}
		for (const k of [...localComposerMetaCache.keys()]) {
			if (!liveLocalComposerKeys.has(k)) localComposerMetaCache.delete(k);
		}
		for (const id of [...calloutMetaCache.keys()]) {
			if (!liveCalloutIds.has(id)) calloutMetaCache.delete(id);
		}

		return out;
	});

	// Register the section with the parent's IntersectionObserver. The observer
	// flips `data-in-view` on the section element when it (or its margin region)
	// intersects the scroll container — see DiffView.svelte for the callback.
	// Eager sections (single-file layout) are always on screen, so they force
	// `inView` and skip the observer entirely.
	$effect(() => {
		if (eager) {
			inView = true;
			return;
		}
		if (!section || !observer) return;
		const node = section;
		const obs = observer;
		obs.observe(node);
		return () => obs.unobserve(node);
	});

	function markInView(v: boolean): void {
		inView = v;
	}
	$effect(() => {
		if (!section) return;
		(section as HTMLElement & { __setInView?: (v: boolean) => void }).__setInView = markInView;
	});

	// Register with the find controller so it can highlight matches inside
	// this section's DOM without owning a global mutation observer over the
	// whole diff view. Find only walks one section's shadow tree at a time —
	// see diff-find.svelte.ts for the rationale.
	//
	// We also hand over `renderIfNeeded` so find can render this file's diff
	// synchronously when the user navigates to a match here, bypassing the
	// FRAME_BUDGET_MS render scheduler queue. Without this fast lane, the
	// target file's render sits behind every other file that scrollIntoView
	// happened to sweep into the IntersectionObserver margin.
	// Value-stable file path. A `$derived` is memoized by `===`, so when the
	// parent hands us a *fresh* `file` object with the SAME path — which happens
	// on every changed-files refresh (window focus, polling, any git op
	// reassigns `app.changedFiles` with new objects) — this does NOT change.
	// Reading `file.path` directly in the registration effect below instead made
	// that effect re-run on every such refresh, tearing down and re-creating the
	// find registration with `renderEpoch: 0` while the diff DOM stayed painted —
	// so find decided the rendered file was unrendered and silently stopped
	// building highlights (the "1 of N but nothing highlighted, works after I
	// switch back" bug). Depending on the stable path keeps registration tied to
	// the section's actual lifetime.
	const findSectionPath = $derived(file.path);

	$effect(() => {
		const sec = section;
		const path = findSectionPath;
		if (!sec) return;
		// `untrack`: registerFindSection reads `find.open`/`find.query` (to fold an
		// already-active search's matches in on mount). Without untrack, this effect
		// would TRACK those, so every keystroke (find.query changing) would re-run
		// it — tearing down and re-registering the section with renderEpoch reset to
		// 0 while the diff DOM stays painted, so find decides the file is unrendered
		// and stops highlighting. We only want to (re)register when the section
		// element or its path actually changes.
		return untrack(() => registerFindSection(path, sec, { renderIfNeeded: forceRenderForFind }));
	});

	// Mirror `inView` into the find controller. Same untrack rationale: the
	// notify reads find state, which we don't want this effect to depend on — it
	// should re-run only when `inView` (or the path) changes.
	$effect(() => {
		const v = inView;
		const path = findSectionPath;
		untrack(() => notifySectionState(path, { inView: v }));
	});

	// Scroll a specific callout's note into view when the sidebar requests it and
	// the callout belongs to this file. Bring the section into view first (which
	// triggers the lazy diff fetch/render), then center the note once it exists,
	// re-aligning while the diff settles. Bounded; cancels if the user scrolls.
	let lastCalloutScrollNonce = 0;
	// Bring an annotation's DOM container (a callout note or a comment) into view,
	// rendering the file first and re-centering while the diff settles. Bounded;
	// cancels the moment the user scrolls. `getEl` is re-read each frame because the
	// container is rebuilt on every Pierre render.
	function scrollToAnnotation(getEl: () => HTMLElement | undefined): void {
		cancelCalloutScroll?.();
		section?.scrollIntoView({ behavior: 'auto', block: 'start' });
		// Render synchronously from cache if possible; otherwise the in-view fetch
		// kicked off above lands within the retry window below.
		forceRenderForFind();
		let raf = 0;
		let stableFrames = 0;
		let lastTop = Number.NaN;
		const deadline = performance.now() + 1500;
		const stop = (): void => {
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			window.removeEventListener('wheel', stop);
			window.removeEventListener('touchstart', stop);
			window.removeEventListener('keydown', stop);
			cancelCalloutScroll = null;
		};
		const tick = (): void => {
			const el = getEl();
			if (el?.isConnected) {
				el.scrollIntoView({ behavior: 'auto', block: 'center' });
				// Stop once the note has held still for a few frames (diff settled).
				const top = el.getBoundingClientRect().top;
				stableFrames = Math.abs(top - lastTop) < 1 ? stableFrames + 1 : 0;
				lastTop = top;
				if (stableFrames >= 3) {
					stop();
					return;
				}
			}
			if (performance.now() < deadline) raf = requestAnimationFrame(tick);
			else stop();
		};
		// Programmatic scrolls don't fire these, so they only trigger on the user
		// taking over.
		window.addEventListener('wheel', stop, { passive: true });
		window.addEventListener('touchstart', stop, { passive: true });
		window.addEventListener('keydown', stop);
		raf = requestAnimationFrame(tick);
		cancelCalloutScroll = stop;
	}

	$effect(() => {
		const req = app.scrollRequest;
		if (!req || !req.calloutId || req.nonce === lastCalloutScrollNonce) return;
		// Only the section that owns this callout responds.
		if (!fileCallouts.some((c) => c.id === req.calloutId)) return;
		lastCalloutScrollNonce = req.nonce;
		// A deferred diff (too large / hidden) hasn't rendered, so its annotation
		// containers don't exist yet — force the load so there's something to
		// scroll to. The retry window in scrollToAnnotation waits for the render.
		if (deferred) loadDiffOverride = true;
		scrollToAnnotation(() => calloutContainers.get(req.calloutId!));
	});

	// Scroll to a comment (local or PR) when the right sidebar asks. Only the
	// section that owns the file responds; the annotation's container is keyed by
	// `req.key` (a local comment id, or `pr-<id>`).
	let lastCommentScrollNonce = 0;
	$effect(() => {
		const req = app.commentScrollTarget;
		if (!req || req.nonce === lastCommentScrollNonce) return;
		if (req.path !== file.path) return;
		lastCommentScrollNonce = req.nonce;
		// As above: if this file's diff was deferred, clicking its comment would
		// otherwise scroll to nothing because the diff never renders. Force the
		// load so the comment's annotation mounts and the scroll can land on it.
		if (deferred) loadDiffOverride = true;
		// `revealPRComment` already forces the target thread's comments expanded
		// (they collapse by default when resolved/outdated); we just scroll to it.
		scrollToAnnotation(() => commentContainers.get(req.key));
	});

	function unmountAll(): void {
		for (const cmp of mountedComponents.values()) {
			try {
				unmount(cmp);
			} catch {
				// ignore
			}
		}
		mountedComponents.clear();
	}

	function disposeDiff(): void {
		unmountAll();
		// The callout nodes die with the instance; clear the map so the scroll
		// handler waits for the fresh ones rather than a detached node.
		calloutContainers.clear();
		commentContainers.clear();
		// The painted annotations die with the instance; clear the baseline so a
		// fresh mount re-applies from scratch rather than comparing against stale.
		appliedAnnotations = [];
		// Drop the parsed metadata + expansion baseline so the next render recomputes
		// from scratch rather than against a previous file's hunks. The new instance
		// starts with no expansion applied.
		fileDiffMeta = null;
		appliedExpanded = new Map();
		if (instance) {
			try {
				instance.cleanUp();
			} catch {
				// ignore
			}
			instance = null;
		}
		// Tear down the raw-view renderer if it was the live one (raw and diff
		// never coexist, so at most one of these has work to do).
		if (rawInstance) {
			try {
				rawInstance.cleanUp();
			} catch {
				// ignore
			}
			rawInstance = null;
		}
		// The staging click listener lives on the shadow root that's about to be
		// destroyed with the container; drop our reference (and detach defensively).
		if (stagingClickRoot) {
			stagingClickRoot.removeEventListener('click', onStagingClick, true);
			stagingClickRoot.removeEventListener('contextmenu', onStagingContextMenu);
			stagingClickRoot = null;
		}
		staging = null;
		// The tokens the hover card may be anchored to are about to be destroyed;
		// drop the indexes and start closing the card (a re-hover elsewhere cancels
		// it). Guarded so non-package.json disposes never touch the shared card.
		if (isPkgJson) {
			pkgDepsNew = null;
			pkgDepsOld = null;
			scheduleHidePackageHover();
		}
		if (diffContainer) {
			diffContainer.remove();
			diffContainer = null;
		}
	}

	function annotationCacheKey(a: DiffLineAnnotation<AnnotationMeta>, index: number): string {
		return `${index}-${a.side}-${a.lineNumber}`;
	}

	// Cheap structural compare so the update effect can skip Pierre's `rerender`
	// when this section's annotations are unchanged. `metadata` is compared by
	// reference — the caches in `lineAnnotations` hand back the same object until
	// the underlying comment/composer actually changes, so an edited comment
	// (fresh meta ref) still triggers a repaint while an unrelated composer
	// opening elsewhere does not.
	function annotationsEqual(
		a: DiffLineAnnotation<AnnotationMeta>[],
		b: DiffLineAnnotation<AnnotationMeta>[]
	): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (
				a[i].metadata !== b[i].metadata ||
				a[i].side !== b[i].side ||
				a[i].lineNumber !== b[i].lineNumber
			) {
				return false;
			}
		}
		return true;
	}

	function renderAnnotation(
		annotation: DiffLineAnnotation<AnnotationMeta>
	): HTMLElement | undefined {
		const meta = annotation.metadata;
		if (!meta) return undefined;
		const container = document.createElement('div');
		// Stamp the same cache key Pierre uses so we can unmount the matching
		// component when the annotation list changes. The current index isn't
		// available here — we read it from the annotations array below.
		const idx = lineAnnotations.indexOf(annotation);
		if (idx >= 0) {
			const key = annotationCacheKey(annotation, idx);
			const existing = mountedComponents.get(key);
			if (existing) {
				try {
					unmount(existing);
				} catch {
					// ignore
				}
			}
			// Agent tour callouts mount their own narration component; everything
			// else is a review comment / composer. Stash the callout's container so a
			// "scroll to callout" request can align it into view.
			if (meta.kind === 'callout') {
				container.dataset.calloutId = meta.callout.id;
				calloutContainers.set(meta.callout.id, container);
				const cmp = mount(CalloutAnnotation, {
					target: container,
					props: { callout: meta.callout }
				});
				mountedComponents.set(key, cmp);
			} else if (meta.kind === 'local-comment' || meta.kind === 'local-composer') {
				// Stash the comment's container so the sidebar's "scroll to comment"
				// can align it into view, mirroring callouts.
				if (meta.kind === 'local-comment') {
					container.dataset.commentId = meta.comment.id;
					commentContainers.set(meta.comment.id, container);
				}
				const cmp = mount(LocalCommentAnnotation, {
					target: container,
					props: { meta }
				});
				mountedComponents.set(key, cmp);
			} else {
				// PR review comment / composer. Track the comment's container under a
				// `pr-<id>` key so the sidebar's "scroll to comment" can reach it too.
				if (meta.kind === 'comment') {
					commentContainers.set(`pr-${meta.comment.id}`, container);
				}
				const cmp = mount(CommentAnnotation, {
					target: container,
					props: { meta }
				});
				mountedComponents.set(key, cmp);
			}
		}
		return container;
	}

	function onDiffLineNumberClick(props: OnDiffLineClickProps): void {
		const side = props.annotationSide === 'deletions' ? 'LEFT' : 'RIGHT';
		if (isPRContext) {
			actions.openComposer(file.path, side, props.lineNumber);
		} else if (isLocalCommentContext) {
			actions.openLocalComposer(file.path, side, props.lineNumber);
		}
	}

	// Pierre's idiomatic gutter affordance: `enableGutterUtility: true` paints
	// their built-in `+` button on hover, and `onGutterUtilityClick` delivers
	// the selected line range when it's clicked. No custom DOM, no event
	// wrestling — Pierre owns the whole interaction.
	function onGutterClick(range: SelectedLineRange): void {
		const sel = range.side ?? 'additions';
		const side = sel === 'deletions' ? 'LEFT' : 'RIGHT';
		// For a plain click `start === end`. Drag-select reports both ends; we
		// attach the comment to the first (top) line for now.
		if (isPRContext) {
			actions.openComposer(file.path, side, range.start);
		} else if (isLocalCommentContext) {
			actions.openLocalComposer(file.path, side, range.start);
		}
	}

	// ----------------------------------------------------------------------
	// Partial (line/hunk) staging — a GitHub-Desktop-style double gutter to the
	// left of the diff.
	//
	// Pierre renders the diff into an open shadow root and tags each gutter cell
	// with `data-line-type` + `data-column-number` (the line number). We prepend
	// two full-height blocks to every cell: an OUTER gutter reflecting the whole
	// hunk's selection (✓ when all of it is staged, − when only some) and an INNER
	// gutter for the single line. Clicking the outer toggles the entire hunk;
	// clicking the inner toggles that one line. Cells are keyed by line number —
	// the stable identity shared with the git patch and the store's exclusion set.
	// CSS custom properties inherit across the shadow boundary, so an injected
	// style element in the shadow root themes the controls. Selection state lives
	// in the store; committing turns it into a reduced patch (see
	// store.buildCommitSelections).
	// ----------------------------------------------------------------------

	// Scoped styles for the injected controls. Lives inside Pierre's shadow root
	// (app.css can't reach in), but `--color-*` vars inherit across the boundary.
	// These rules are unlayered, so they outrank Pierre's `@layer`-ed styles (e.g.
	// the cell's `padding-inline`) regardless of specificity.
	const STAGING_STYLE_ID = 'sr-staging-style';
	const STAGING_CSS = `
		:host {
			--sr-gw: 18px;
			--sr-bg-off: var(--color-muted, #8882);
			--sr-bg-on: color-mix(in srgb, var(--color-primary, #888) 50%, var(--color-muted, #fff));
			--sr-bg-hover: color-mix(in srgb, var(--color-primary, #888) 22%, var(--color-muted, #fff));
		}
		/* Reserve room for both gutter columns to the left of the line number. */
		[data-column-number] { position: relative; padding-left: calc(2 * var(--sr-gw) + 6px); }
		/* Pierre indents the collapsed-context separator's wrapper by one gap
		   (~8px), which pushes its expander out of line with our gutter columns.
		   Drop it so the expander sits flush at the gutter's left edge. */
		[data-separator-wrapper] { padding-left: 0; }
		.sr-gutter {
			box-sizing: border-box; margin: 0; padding: 0; border: 0;
			border-right: 1px solid var(--color-border, #8884);
			background: var(--sr-bg-off); z-index: 4; cursor: pointer;
		}
		.sr-gutter.is-on { background: var(--sr-bg-on); }
		.sr-gutter:hover { background: var(--sr-bg-hover); }
		.sr-gutter[data-state='check']::after {
			content: ''; width: 4px; height: 7px;
			border: solid var(--color-primary-foreground, #fff);
			border-width: 0 2px 2px 0; transform: rotate(45deg);
		}
		.sr-gutter[data-state='minus']::after {
			content: ''; width: 8px; height: 2px; border-radius: 1px;
			background: var(--color-primary-foreground, #fff);
		}
		/* Inner column: one block per changed line, inside each gutter cell. */
		.sr-gutter-inner {
			position: absolute; top: 0; bottom: 0; left: var(--sr-gw); width: var(--sr-gw);
			display: grid; place-items: center;
		}
		.sr-gutter-inner[data-state='check']::after { margin-top: -1px; }
		/* Single-line section: the lone checkbox stands in for the hunk control, so
		   center it across both gutter columns (no separate outer button is drawn). */
		.sr-gutter-inner.sr-gutter-solo { left: calc(var(--sr-gw) / 2); }
		/* Outer column: a SINGLE button spanning the whole hunk, absolutely
		   positioned over the gutter wrapper (top/height set inline per group).
		   The icon sits on the hunk's first line. */
		.sr-gutter-outer {
			position: absolute; left: 0; width: var(--sr-gw);
			display: flex; justify-content: center; align-items: flex-start;
			padding-top: calc((1lh - 7px) / 2);
		}
		.sr-excluded [data-line-number-content] { opacity: 0.4; }
	`;

	// Breathing room around Pierre's hover `+` comment button. By default Pierre
	// pins the button to the right edge of the line-number column and then yanks
	// it ~12px further right (`margin-right: calc(1ch - 1lh)`), so it lands on top
	// of the first code token. Instead: widen the gutter (the number column is
	// `minmax(min-content, max-content)`, so padding-right grows it), pad the code
	// line, and center the button on the number/code seam so it sits in its own
	// lane between the two — never over a token.
	//
	// The spacing goes on the colored cells themselves — the number cell
	// (`[data-column-number]`) and the per-line code element (`[data-line]`),
	// which both carry `--diffs-line-bg` — NOT on the `[data-content]` column
	// wrapper (plain `--diffs-bg`). Padding the wrapper would expose an uncolored
	// strip and visibly break the diff's line background.
	//
	// These cells live in Pierre's shadow DOM, so a light-DOM stylesheet can't
	// reach them. We feed this through Pierre's `unsafeCSS` option, which injects
	// into the shadow root under `@layer unsafe` (the top layer) — outranking
	// Pierre's own `@layer base` rules for padding and the button margin.
	// The button pins to the number cell's right padding edge, which sits inside
	// the seam by the 2px gutter/content border (`--diffs-gap-style`). translateX
	// of half the button width lands its center on that padding edge — 1px shy of
	// the visual gap's midpoint, so add 1px (half the border) to balance it.
	const GUTTER_UTILITY_CSS = `
		[data-column-number] { padding-right: 14px; }
		[data-content] [data-line], [data-column-content] { padding-left: 14px; }
		[data-utility-button] { margin-right: 0; transform: translateX(calc(50% + 1px)); }
	`;

	// Parse the git patch into the file's full set of changed-line keys.
	function buildStagingModel(patch: string): StagingModel | null {
		const parsed = parseFilePatch(patch);
		if (!parsed) return null;
		const allKeys = changedLineKeys(file.path, parsed);
		if (allKeys.length === 0) return null;
		return { allKeys };
	}

	// Pierre's shadow root for the current diff (where the gutter cells live).
	function stagingRoot(): ShadowRoot | null {
		return diffContainer?.shadowRoot ?? null;
	}

	// Pierre's onPostRender hook — fires after the first (plain-text) render AND
	// after the async worker rerender that swaps in syntax-highlighted nodes. Both
	// rebuild the shadow DOM, so besides re-applying the staging gutters we tell
	// the find controller its cached highlight Ranges for this file just dangled
	// (their text nodes were replaced) and it should re-walk + repaint. Without
	// this, find's yellow/orange highlights vanish the instant the highlight worker
	// returns and only come back on a full re-render (e.g. switching tabs).
	function onPierrePostRender(): void {
		applyStagingControls();
		applyIndentGuidesNow();
		notifySectionState(file.path, { bumpRenderEpoch: true });
	}

	// The file's detected indent unit in columns, computed lazily from the
	// loaded contents and cached until the data changes (-1 = not detected yet).
	let indentStep = -1;

	// Paint the indent guides over the current Pierre DOM (diff or raw view).
	// Runs after every Pierre render/rerender and when the setting turns on;
	// the painter itself is idempotent.
	function applyIndentGuidesNow(): void {
		if (!app.indentGuides) return;
		const root = diffContainer?.shadowRoot;
		if (!root || !diffData) return;
		if (indentStep < 0) {
			// Prefer the new side; a deleted file only has old contents.
			indentStep = detectIndentStep(diffData.newContents || diffData.oldContents);
		}
		applyIndentGuides(root, indentStep);
	}

	// Called after each Pierre render/rerender: (re)inject the controls, ensure
	// the scoped stylesheet, and (re)bind the click listener to the shadow root.
	function applyStagingControls(): void {
		if (!staging) return;
		const root = stagingRoot();
		if (!root) return;
		if (!root.getElementById(STAGING_STYLE_ID)) {
			const style = document.createElement('style');
			style.id = STAGING_STYLE_ID;
			style.textContent = STAGING_CSS;
			root.appendChild(style);
		}
		if (stagingClickRoot !== root) {
			stagingClickRoot?.removeEventListener('click', onStagingClick, true);
			stagingClickRoot?.removeEventListener('contextmenu', onStagingContextMenu);
			// Capture phase: our gutter checkboxes live INSIDE Pierre's line-number
			// cell, so a click on one also reaches Pierre's `onLineNumberClick`
			// handler (which would open the comment composer). Pierre delegates on the
			// shadow root and registered first (we attach via onPostRender, after its
			// render), so a bubble-phase listener can't stopPropagation in time.
			// Capturing lets us intercept and stop the event before Pierre sees it.
			root.addEventListener('click', onStagingClick, true);
			root.addEventListener('contextmenu', onStagingContextMenu);
			stagingClickRoot = root;
		}
		syncStagingControls(root);
	}

	// Line keys backing each spanning outer (hunk) button, so a click can toggle
	// the whole group. Keyed off the element; WeakMap so removed buttons are GC'd.
	const outerKeys = new WeakMap<HTMLElement, string[]>();

	// Get (or lazily create) a changed cell's inner (per-line) gutter block. It's
	// the cell's first child so it paints to the left of the line number.
	function ensureInnerBlock(cell: HTMLElement): HTMLButtonElement {
		let block = cell.querySelector<HTMLButtonElement>(':scope > [data-sr-gutter-inner]');
		if (!block) {
			block = document.createElement('button');
			block.type = 'button';
			block.setAttribute('data-sr-gutter-inner', '');
			block.setAttribute('role', 'checkbox');
			block.className = 'sr-gutter sr-gutter-inner';
			cell.insertBefore(block, cell.firstChild);
		}
		return block;
	}

	// A contiguous run of changed lines within one gutter (a "section"): the rows
	// a single outer button spans. Broken by context lines and by any vertical gap
	// (e.g. a split-view buffer), so the deletion and addition blocks of a change
	// are independent sections rather than one.
	interface GutterSection {
		top: number;
		bottom: number;
		keys: string[];
		cells: HTMLElement[];
	}

	// Reconcile the gutter controls with the store's selection. The inner column
	// gets one block per changed line; the outer column gets ONE button spanning
	// each contiguous changed section, absolutely positioned over the gutter so it
	// reads (and behaves) as a single hunk control. Runs on (re)render and whenever
	// the staging sets change.
	function syncStagingControls(root: ShadowRoot): void {
		if (!staging) return;
		const fileExcluded = app.excludedFromCommit.has(file.path);

		// One pass per code block (unified has one gutter; split has deletions +
		// additions gutters). Sections never span across gutters.
		for (const gutter of root.querySelectorAll<HTMLElement>('[data-gutter]')) {
			const sections: GutterSection[] = [];
			let current: GutterSection | null = null;

			// Pass 1 (writes): per-line inner blocks. Collect changed cells in order.
			const changedCells: { cell: HTMLElement; key: string; included: boolean }[] = [];
			for (const cell of gutter.querySelectorAll<HTMLElement>('[data-column-number]')) {
				const type = cell.getAttribute('data-line-type') ?? '';
				const isAdd = type === 'additions' || type === 'change-addition';
				const isDel = type === 'deletions' || type === 'change-deletion';
				if (!isAdd && !isDel) {
					// Context line: no band. Drop a stale block if the cell ever had one.
					cell.querySelector(':scope > [data-sr-gutter-inner]')?.remove();
					cell.classList.remove('sr-excluded');
					continue;
				}
				const num = Number(cell.getAttribute('data-column-number'));
				if (Number.isNaN(num)) continue;
				const side: DiffSide = isAdd ? 'addition' : 'deletion';
				const key = stagingLineKey(file.path, side, num);
				const included = !fileExcluded && !app.stagingLineExclusions.has(key);

				const inner = ensureInnerBlock(cell);
				inner.dataset.srSide = side;
				inner.dataset.srLine = String(num);
				inner.classList.toggle('is-on', included);
				inner.dataset.state = included ? 'check' : 'none';
				inner.setAttribute('aria-checked', String(included));
				inner.setAttribute(
					'aria-label',
					included ? 'Exclude line from commit' : 'Include line in commit'
				);
				cell.classList.toggle('sr-excluded', !included);
				changedCells.push({ cell, key, included });
			}

			// Pass 2 (reads): group consecutive, vertically-adjacent changed cells
			// into sections using their laid-out geometry.
			let prevCell: HTMLElement | null = null;
			for (const { cell, key } of changedCells) {
				const top = cell.offsetTop;
				const bottom = top + cell.offsetHeight;
				const adjacent =
					current != null &&
					prevCell != null &&
					prevCell === cell.previousElementSibling &&
					Math.abs(top - current.bottom) < 1;
				if (adjacent && current) {
					current.bottom = bottom;
					current.keys.push(key);
					current.cells.push(cell);
				} else {
					current = { top, bottom, keys: [key], cells: [cell] };
					sections.push(current);
				}
				prevCell = cell;
			}

			// Pass 3 (writes): one outer button per section, rebuilt each sync since
			// its state and the section boundaries can change.
			for (const stale of gutter.querySelectorAll(':scope > [data-sr-gutter-outer]')) {
				stale.remove();
			}
			for (const section of sections) {
				// A single-line section needs no separate hunk control: its lone
				// per-line checkbox already toggles the whole "hunk". Center that
				// checkbox across both gutter columns (sr-gutter-solo) and skip the
				// outer button so the two don't stack up side by side.
				const solo = section.keys.length === 1;
				for (const cell of section.cells) {
					cell
						.querySelector(':scope > [data-sr-gutter-inner]')
						?.classList.toggle('sr-gutter-solo', solo);
				}
				if (solo) continue;

				const includedCount = section.keys.filter((k) => !app.stagingLineExclusions.has(k)).length;
				const full = !fileExcluded && includedCount === section.keys.length;
				const some = !fileExcluded && includedCount > 0;
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.setAttribute('data-sr-gutter-outer', '');
				btn.className = 'sr-gutter sr-gutter-outer';
				btn.style.top = `${section.top}px`;
				btn.style.height = `${section.bottom - section.top}px`;
				btn.classList.toggle('is-on', some);
				btn.dataset.state = some ? (full ? 'check' : 'minus') : 'none';
				btn.setAttribute('aria-label', full ? 'Unstage section' : 'Stage section');
				outerKeys.set(btn, section.keys);
				gutter.appendChild(btn);
			}
		}
	}

	function onStagingClick(e: Event): void {
		if (!staging) return;
		const target = e.target as HTMLElement;
		// Outer gutter: one button spanning the section — toggle all of its lines.
		const hunkBtn = target.closest<HTMLElement>('[data-sr-gutter-outer]');
		if (hunkBtn) {
			e.preventDefault();
			e.stopImmediatePropagation();
			const keys = outerKeys.get(hunkBtn) ?? [];
			if (keys.length === 0) return;
			const allIncluded =
				!app.excludedFromCommit.has(file.path) &&
				keys.every((k) => !app.stagingLineExclusions.has(k));
			actions.setLinesIncludedForCommit(file.path, keys, !allIncluded, staging.allKeys);
			return;
		}
		// Inner gutter: toggle the single line.
		const lineBtn = target.closest<HTMLElement>('[data-sr-gutter-inner]');
		if (lineBtn) {
			e.preventDefault();
			e.stopImmediatePropagation();
			const side = lineBtn.dataset.srSide as DiffSide;
			const lineNum = Number(lineBtn.dataset.srLine);
			const key = stagingLineKey(file.path, side, lineNum);
			const included =
				!app.excludedFromCommit.has(file.path) && !app.stagingLineExclusions.has(key);
			actions.setLinesIncludedForCommit(file.path, [key], !included, staging.allKeys);
		}
	}

	// Right-click on a staging gutter control: offer a native discard menu — the
	// destructive counterpart to the checkbox under the cursor. The outer (hunk)
	// button discards every changed line in its section ("Discard modified
	// lines"); an inner button discards just its line ("Discard modified line").
	// Anchoring on the gutter buttons (rather than the code rows) means the menu
	// is available for every changed line, including whitespace-only ones.
	function onStagingContextMenu(e: Event): void {
		if (!staging) return;
		const target = e.target as HTMLElement;
		// Outer gutter: one button spanning a section — discard all its lines.
		const hunkBtn = target.closest<HTMLElement>('[data-sr-gutter-outer]');
		if (hunkBtn) {
			const keys = outerKeys.get(hunkBtn) ?? [];
			if (keys.length === 0) return;
			e.preventDefault();
			e.stopPropagation();
			void actions.discardDiffLines(file.path, keys, 'lines');
			return;
		}
		// Inner gutter: a single line.
		const lineBtn = target.closest<HTMLElement>('[data-sr-gutter-inner]');
		if (lineBtn) {
			const side = lineBtn.dataset.srSide as DiffSide;
			const num = Number(lineBtn.dataset.srLine);
			if (Number.isNaN(num)) return;
			const key = stagingLineKey(file.path, side, num);
			e.preventDefault();
			e.stopPropagation();
			void actions.discardDiffLines(file.path, [key], 'line');
		}
	}

	// Repaint the checkboxes in place whenever the staging selection changes —
	// e.g. a toggle here, a hunk toggle, or the file's sidebar checkbox. Reading
	// both sets' sizes registers the reactive dependency; any add/delete repaints.
	$effect(() => {
		void app.stagingLineExclusions.size;
		void app.excludedFromCommit.size;
		if (!staging || renderedKey == null) return;
		const root = stagingRoot();
		if (root) syncStagingControls(root);
	});

	// Render the whole file (no diff) into the shared host using Pierre's File
	// renderer — the "Raw" view. Reuses the same web component tag, worker pool
	// and theme as the diff so the file reads identically minus the +/− gutters.
	// For a deletion there's no post-change file, so show the removed contents.
	// The whole-file payload for the raw view. For a deletion there's no
	// post-change file, so show the removed contents. `cacheKey` lets the worker
	// pool cache the highlighted AST so a later render (toggling Diff↔Raw, a
	// theme-type swap, or a hover-prime landing before the click) reuses it
	// instead of re-tokenizing the *whole* file — without it Pierre re-highlights
	// from scratch every render (see WorkerPoolManager.fileCache, keyed solely by
	// cacheKey). Keyed by context + path + side + dataEpoch, which bumps only when
	// the contents actually change, so the cache stays valid across renders of the
	// same content and is invalidated on a real edit.
	function rawFileContents(diff: DiffData): FileContents {
		const deleted = diff.file.status === 'deleted';
		return {
			name: deleted ? (diff.file.oldPath ?? diff.file.path) : diff.file.path,
			contents: deleted ? diff.oldContents : diff.newContents,
			cacheKey: loadedCtxKey
				? `raw:${loadedCtxKey}:${file.path}:${deleted ? 'old' : 'new'}:${dataEpoch}`
				: undefined
		};
	}

	// Warm the worker's highlight cache for the raw view before it's shown. Called
	// when the user points at the toggle: tokenizing the whole file is the slow
	// part, so giving the workers a head start (the result lands in the cache
	// under the same cacheKey renderRaw uses) means the actual click paints
	// highlighted with little or no wait. Deduped by cacheKey, so a graze that
	// never becomes a click costs at most the one tokenize the click would anyway.
	function primeRawHighlight(): void {
		const pool = getDiffWorkerPool();
		if (!pool || !diffData || !loadedCtxKey || diffData.file.isBinary) return;
		const fc = rawFileContents(diffData);
		if (!fc.contents || !fc.cacheKey) return;
		pool.primeFileHighlightCache(fc);
	}

	function renderRaw(diff: DiffData): void {
		if (!host) return;

		diffContainer = document.createElement(DIFFS_TAG_NAME);
		// `host` is ours and Svelte doesn't manage its children — Pierre renders
		// into this element, so the manual append is intentional.
		// eslint-disable-next-line svelte/no-dom-manipulating
		host.appendChild(diffContainer);

		rawInstance = new FileClass(
			{
				themeType: app.theme,
				disableFileHeader: true,
				// Repaint the indent guides after each render, including the async
				// worker rerender that swaps in the highlighted nodes.
				onPostRender: () => applyIndentGuidesNow()
			},
			getDiffWorkerPool()
		);

		try {
			rawInstance.render({
				file: rawFileContents(diff),
				fileContainer: diffContainer
			});
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		}
	}

	function renderDiff(diff: DiffData): void {
		if (!host) return;
		disposeDiff();
		if (diff.file.isBinary) return;

		// Raw view: render the whole file instead of the diff. Comments, staging
		// and hunk expansion are diff-only; their effects all bail while `instance`
		// is null (renderRaw never assigns it), so nothing else needs to branch.
		if (showRaw) {
			renderRaw(diff);
			return;
		}

		// Build the per-hunk staging model from the raw git patch up front so the
		// gutter checkboxes can be injected as soon as Pierre finishes rendering.
		staging = stagingEnabled && diff.patch ? buildStagingModel(diff.patch) : null;

		diffContainer = document.createElement(DIFFS_TAG_NAME);
		// `host` is ours and Svelte doesn't manage its children — Pierre renders
		// into this element, so the manual append is intentional.
		// eslint-disable-next-line svelte/no-dom-manipulating
		host.appendChild(diffContainer);

		const namePair = {
			old: diff.file.oldPath ?? diff.file.path,
			new: diff.file.path
		};
		const oldFile = { name: namePair.old, contents: diff.oldContents };
		const newFile = { name: namePair.new, contents: diff.newContents };

		// Index this package.json's dependency tokens per side so the hover card
		// can resolve a hovered token to its package name/version range.
		if (isPkgJson) {
			pkgDepsNew = parsePackageDeps(diff.newContents);
			pkgDepsOld = parsePackageDeps(diff.oldContents);
		}

		// Identical sides have nothing to diff — which includes a newly added empty
		// file (both sides '') and mode-only changes that somehow still fetched.
		// parseDiffFromFile *throws* on this case ("if the files are the same
		// maybe?"), but it isn't an error: show the same empty-state as a 0/0
		// file list entry. Surfacing it as loadError would show a bogus banner
		// and, because loadError persists across renders, leave that banner stuck
		// once the file later gains content. Clearing fileDiffMeta keeps stale
		// hunk metadata from a previous render from lingering.
		if (oldFile.contents === newFile.contents) {
			fileDiffMeta = null;
			loadError = null;
			identicalSides = true;
			return;
		}
		identicalSides = false;

		// Parse Pierre's own diff metadata up front: its hunks (not the git patch)
		// are what the expansion targets, and we need them before the first render so
		// collapsed regions around comments expand on the first paint (no flash).
		let metadata: FileDiffMetadata | undefined | null;
		try {
			metadata = parseDiffFromFile(oldFile, newFile);
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
			return;
		}
		if (!metadata) return;
		fileDiffMeta = metadata;

		instance = new FileDiffClass<AnnotationMeta>(
			{
				diffStyle: app.viewMode,
				themeType: app.theme,
				disableFileHeader: true,
				// Character-level intra-line diffs. Only takes effect on the
				// main-thread fallback render; when the worker pool is active its own
				// highlighterOptions.lineDiffType wins (see diff-worker-pool.ts).
				lineDiffType: 'char',
				renderAnnotation,
				onLineNumberClick: onDiffLineNumberClick,
				// Gutter/code spacing + `+` button centering, injected into Pierre's
				// shadow DOM (scoped component styles can't reach these cells).
				unsafeCSS: GUTTER_UTILITY_CSS,
				// Built-in gutter `+` button (the one with `data-utility-button`).
				// Only enable it where commenting is meaningful — toggled live below
				// via setOptions + flushManagers when `canComment` changes.
				enableGutterUtility: canComment,
				onGutterUtilityClick: onGutterClick,
				// Token-level hover → npm info cards, only wired for package.json so
				// Pierre doesn't track hovered tokens for every other file.
				onTokenEnter: isPkgJson ? onTokenEnter : undefined,
				onTokenLeave: isPkgJson ? onTokenLeave : undefined,
				// Inject the staging gutters after every (re)render. Pierre rebuilds
				// its shadow DOM on render and on the worker's async highlight
				// rerender, so re-apply each time.
				onPostRender: onPierrePostRender
			},
			// Highlight + diff-AST work runs on the shared worker pool so the main
			// thread stays responsive; FileDiff paints plain text first, then
			// rerenders when the worker returns the highlighted AST. Falls back to
			// the main-thread highlighter when the pool is unavailable.
			getDiffWorkerPool()
		);

		// Reveal just enough of any collapsed region to show a comment anchored
		// outside the shown hunks, before the first paint (no rerender needed —
		// render() below picks up the expanded state).
		applyExpandedHunks(computeExpandedHunks(metadata, commentAnchors), false);

		try {
			instance.render({
				fileContainer: diffContainer,
				fileDiff: metadata,
				oldFile,
				newFile,
				lineAnnotations
			});
			// render() already painted these — record them as the baseline so the
			// update effect doesn't fire a redundant rerender on its first pass.
			appliedAnnotations = lineAnnotations;
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		}
	}

	// What the DOM *should* reflect given the currently loaded data + UI mode.
	// Compared against `renderedKey` to decide whether a (re)render is needed.
	const targetRenderKey = $derived(
		loadedCtxKey && diffData
			? `${loadedCtxKey}::${app.viewMode}::raw=${showRaw}::${dataEpoch}`
			: null
	);

	// True when there's no DOM in the host yet for the current data — the
	// placeholder uses this to keep "Loading diff…" visible across the gap
	// between data landing and the scheduler actually running renderDiff.
	const isAwaitingFirstRender = $derived(targetRenderKey !== null && renderedKey === null);

	function setLoadedDiff(d: DiffData, ctxKey: string): void {
		diffData = d;
		loadedCtxKey = ctxKey;
		dataEpoch++;
		// New contents may indent differently; re-detect on the next paint.
		indentStep = -1;
		// The find index reads from the diff cache; signal it that new patch
		// text just landed so any active query can incorporate this file.
		notifySectionState(file.path, { dataLoaded: true });
	}

	function clearLoadedDiff(): void {
		diffData = null;
		loadedCtxKey = null;
		indentStep = -1;
		identicalSides = false;
		cancelPendingRender?.();
		cancelPendingRender = null;
		disposeDiff();
		renderedKey = null;
		// Drop any cached find Ranges into this section's DOM — they reference
		// nodes that disposeDiff() just removed.
		notifySectionState(file.path, { bumpRenderEpoch: true });
	}

	// Hand the actual DOM work to the global render scheduler so the UI can
	// paint state changes (tab switch, dialog close) before this section
	// synchronously rebuilds its diff. The scheduler time-budgets the queue
	// across animation frames; even a viewMode flip that invalidates every
	// visible section stays under the per-frame budget.
	function queueRender(data: DiffData, target: string): void {
		cancelPendingRender?.();
		cancelPendingRender = scheduleRender(() => {
			cancelPendingRender = null;
			renderDiff(data);
			renderedKey = target;
			// Tell find that this section's DOM was replaced — it must invalidate
			// any cached Ranges (whose Text nodes just got removed) and rebuild
			// highlights against the fresh DOM.
			notifySectionState(file.path, { bumpRenderEpoch: true });
		});
	}

	// Render the diff right now, skipping the render scheduler. Called by find
	// when the user navigates here so the highlight doesn't sit behind every
	// other queued render. Hydrates from the diff cache if data hasn't loaded
	// through the lazy path yet. Returns true if rendered DOM is available
	// by the time we return (already rendered, or just rendered in-place);
	// false when data hasn't been fetched and we have nothing to render yet.
	function forceRenderForFind(): boolean {
		if (host == null) return false;
		// Never render into a hidden host. A collapsed file we were just asked to
		// jump to is wrapped in `hidden={!expanded}`; if the caller invokes this in
		// the same tick it flips `expanded`, the wrapper is still `display:none` and
		// Pierre measures the container at 0×0 — producing a blank diff that never
		// recovers (renderedKey is set, so the render effect won't re-run). Bail so
		// the normal render effect paints it once the wrapper is actually shown.
		// `offsetParent === null` is display:none specifically; the prerender
		// neighbours use visibility:hidden (offsetParent stays set), where Pierre
		// measures fine, so those still take the fast lane.
		if (host.offsetParent === null) return false;
		let data = diffData;
		let ctxKey = loadedCtxKey;
		if (data == null && app.activeRepo) {
			const ctx = $state.snapshot(app.diffContext) as DiffContext;
			const cached = getCachedDiff(app.activeRepo.id, ctx, file.path);
			if (cached) {
				ctxKey = diffContextKey(ctx);
				setLoadedDiff(cached, ctxKey);
				data = cached;
			}
		}
		if (data == null || ctxKey == null) return false;
		if (data.file.isBinary || data.truncated) return false;
		// dataEpoch has just been bumped by setLoadedDiff (or was already current).
		const target = `${ctxKey}::${app.viewMode}::raw=${showRaw}::${dataEpoch}`;
		if (renderedKey === target) return true;
		cancelPendingRender?.();
		cancelPendingRender = null;
		renderDiff(data);
		renderedKey = target;
		// Mark the reload token applied. A section whose lazy-fetch effect has
		// never run still has appliedReloadToken === -1, so its first run computes
		// `forced = reloadToken !== -1 = true` and clearLoadedDiff()s — throwing
		// away the diff we just rendered from cache, then re-rendering it through
		// the (slower, scheduled) path. That double-render is exactly the lag find
		// is trying to avoid by rendering synchronously here. Claiming the token
		// lets the fetch effect treat this data as current (a silent background
		// revalidate at most), so the synchronous render survives.
		if (appliedReloadToken === -1) appliedReloadToken = app.diffReloadToken;
		notifySectionState(file.path, { bumpRenderEpoch: true });
		return true;
	}

	// The diff-reload token last applied here. When the store bumps the token
	// (after a merge/pull/etc. rewrites files in place) this section re-fetches
	// even though its context is unchanged.
	let appliedReloadToken = -1;
	// Same idea for the revalidate token (bumped on focus/poll refresh), but the
	// re-fetch here is silent: the current diff stays on screen and is swapped
	// only if disk came back different — so external edits land without flicker.
	let appliedRevalidateToken = -1;
	// The per-file reload token last applied here. Bumped (per path) when a
	// single-file in-place edit (discarding a line/hunk) rewrites just this file, so
	// this section silently re-fetches and swaps in place while every other section
	// is left untouched. Folded into `revalidate` below, not `forced`.
	let appliedFileReloadToken = -1;

	// Fetch the diff the first time the section enters view (and stays expanded).
	// Hydrates from the cross-tab diff cache when available so switching back
	// to a context renders instantly, then refreshes in the background. The
	// actual DOM render is kicked off by the render effect below.
	$effect(() => {
		// Read the tokens first so the effect re-runs when an op forces a reload, a
		// focus/poll refresh asks open sections to re-validate against disk, or a
		// single-file in-place edit bumps just this path. SvelteMap tracks reads per
		// key, so only the edited file's section re-runs on a per-file bump.
		const reloadToken = app.diffReloadToken;
		const revalidateToken = app.diffRevalidateToken;
		const fileReloadToken = app.diffFileReloadTokens.get(file.path) ?? 0;
		if (!inView || !expanded || !app.activeRepo) return;
		// Don't fetch hidden diffs — wait until the user clicks "Load diff". When
		// they do, `deferred` flips false and this effect re-runs to fetch.
		if (deferred) return;
		// Nothing useful to render when there's no textual change (mode-only,
		// pure rename/copy, empty file, etc.).
		if (noContentChanges) return;
		const repo = app.activeRepo;
		const ctx = $state.snapshot(app.diffContext) as DiffContext;
		const ctxKey = diffContextKey(ctx);
		// A bumped reload token means this file was rewritten in place (merge, pull,
		// etc.), so re-fetch even though the context matches what's already loaded.
		const forced = reloadToken !== appliedReloadToken;
		// A bumped revalidate token means files may have changed on disk outside the
		// app; a bumped per-file token means a single-file in-place edit (discard
		// line/hunk) rewrote just this file. Both re-fetch silently: the current diff
		// stays on screen and is swapped only if the content actually changed, so the
		// edited section updates without a dispose-to-blank flash (and the caller
		// primes the cache, so a section not currently showing hydrates instantly).
		const revalidate =
			revalidateToken !== appliedRevalidateToken || fileReloadToken !== appliedFileReloadToken;
		// Already up to date for this context with nothing asking us to refresh,
		// or a (non-forced) fetch is already in flight.
		if (diffData && loadedCtxKey === ctxKey && !forced && !revalidate) return;
		if (loading && !forced) return;
		appliedReloadToken = reloadToken;
		appliedRevalidateToken = revalidateToken;
		appliedFileReloadToken = fileReloadToken;

		// True when the right diff for this context is already rendered. A pure
		// revalidation leaves it in place and refreshes silently underneath.
		const showing = diffData !== null && loadedCtxKey === ctxKey;

		const cached = getCachedDiff(repo.id, ctx, file.path);
		// Drop stale DOM/render state when the context changed or a reload was
		// forced — the cached hit (if any) no longer reflects the file on disk.
		if (forced || (loadedCtxKey && loadedCtxKey !== ctxKey)) clearLoadedDiff();

		if (!showing) {
			if (cached) {
				setLoadedDiff(cached, ctxKey);
				loadError = null;
			} else {
				loading = true;
				loadError = null;
			}
		}

		// What's on screen right now, used to decide whether the re-fetch changed
		// anything. On a revalidation it's the (possibly stale) rendered diff;
		// otherwise it's the cache hit we just hydrated from.
		const shownBefore = showing ? diffData : cached;

		void window.api.git
			.getDiff(repo.id, file.path, ctx)
			.then((d) => {
				setCachedDiff(repo.id, ctx, file.path, d);
				// Bail if the user moved on while we were fetching.
				if (!app.activeRepo || app.activeRepo.id !== repo.id) return;
				const currentKey = diffContextKey($state.snapshot(app.diffContext) as DiffContext);
				if (currentKey !== ctxKey) return;
				// Skip the re-render when what's shown already matched what came back.
				if (
					shownBefore &&
					shownBefore.oldContents === d.oldContents &&
					shownBefore.newContents === d.newContents &&
					shownBefore.patch === d.patch &&
					shownBefore.oldImage === d.oldImage &&
					shownBefore.newImage === d.newImage
				) {
					return;
				}
				setLoadedDiff(d, ctxKey);
			})
			.catch((err) => {
				// Keep a rendered diff in place if a background revalidation fails;
				// only surface the error when there was nothing to show.
				if (!shownBefore) loadError = err instanceof Error ? err.message : String(err);
			})
			.finally(() => {
				loading = false;
			});
	});

	// Render effect — runs whenever the target diverges from what's in the DOM.
	// Visible sections queue through the scheduler; off-screen ones drop their
	// stale DOM and wait for the next scroll-into-view tick. That keeps the
	// queue short on viewMode flips so the visible diffs render fast instead
	// of being stuck behind hundreds of off-screen re-renders.
	$effect(() => {
		const target = targetRenderKey;
		if (target === null) return;
		if (renderedKey === target) return;
		if (!inView) {
			if (renderedKey !== null) {
				cancelPendingRender?.();
				cancelPendingRender = null;
				disposeDiff();
				renderedKey = null;
				// The diff DOM is gone — tell find so it drops this file's now-dangling
				// highlight Ranges. Find gates on renderEpoch (not inView), so a bump is
				// what signals "the DOM you cached ranges against no longer exists".
				notifySectionState(file.path, { bumpRenderEpoch: true });
			}
			return;
		}
		// Don't render into a hidden host. Pierre measures the container while it
		// renders, and inside a `display:none` subtree (the code host is hidden
		// whenever the Markdown/image preview is shown) it measures 0×0 and stays
		// collapsed even after the host is revealed — so toggling back to Code
		// would show a blank diff. Defer until the code view is actually visible;
		// flipping the preview off re-runs this effect (hostVisible is reactive).
		if (!hostVisible) return;
		queueRender(diffData!, target);
	});

	// Push new annotations into the live FileDiff instance. `setLineAnnotations`
	// alone only updates Pierre's internal pointer — `rerender` is what actually
	// walks the annotation cache and paints new entries. The cache key is
	// `${index}-${side}-${lineNumber}`, so existing comment DOM survives and
	// only newly-keyed annotations trigger a `renderAnnotation` call.
	//
	// IMPORTANT: read `lineAnnotations` *first* so Svelte registers it as a
	// dependency even on the early-mount pass when `instance` is still null.
	// `instance` is a plain `let` (not `$state`), so it doesn't trigger
	// re-runs on assignment — without reading the derived up-front, this
	// effect would never re-fire when the user adds a composer.
	$effect(() => {
		const annotations = lineAnnotations;
		if (!instance) return;
		// Bail before touching Pierre when nothing on THIS file changed. Opening a
		// composer reassigns the whole `app.pendingComposers` object, so this
		// effect fires on every mounted section — but only the section the composer
		// belongs to has a different annotation list. Skipping the rest keeps the
		// cost of opening a composer O(1) instead of O(visible diffs).
		if (annotationsEqual(annotations, appliedAnnotations)) return;
		appliedAnnotations = annotations;
		// Drop cached mounted components that no longer have a matching index.
		const liveKeys = new Set(annotations.map((a, i) => annotationCacheKey(a, i)));
		for (const key of [...mountedComponents.keys()]) {
			if (!liveKeys.has(key)) {
				const cmp = mountedComponents.get(key);
				if (cmp) {
					try {
						unmount(cmp);
					} catch {
						// ignore
					}
				}
				mountedComponents.delete(key);
			}
		}
		instance.setLineAnnotations(annotations);
		instance.rerender();
	});

	// Toggle Pierre's built-in gutter `+` button live as the user switches
	// between commentable / non-commentable contexts. `setOptions` swaps the
	// option bag, `flushManagers` reruns `InteractionManager.setup`, which is
	// the path that adds (or removes) the gutter container.
	// Same caveat as the annotations effect: read `isPRContext` first so the
	// dependency is registered even when `instance` is null on first run.
	$effect(() => {
		const enabled = canComment;
		if (!instance) return;
		type WithOptions = { options: Record<string, unknown> };
		const current = (instance as unknown as WithOptions).options;
		if (current.enableGutterUtility === enabled) return;
		instance.setOptions({ ...current, enableGutterUtility: enabled } as Parameters<
			typeof instance.setOptions
		>[0]);
		instance.flushManagers();
	});

	// Reveal/hide the collapsed regions around comments live as comments come and
	// go, so a comment landing outside the changed hunks becomes visible without a
	// manual expand. Changing `expandedHunks` re-lays-out the diff, so `rerender`
	// (not just `flushManagers`). Read the derived first so the dependency is
	// registered even while `instance` is null on the first run.
	$effect(() => {
		const map = expandedHunksForComments;
		if (!instance) return;
		applyExpandedHunks(map, true);
	});

	// Toggle indent guides live, without a Pierre re-render: turning them on
	// paints over the existing DOM, turning them off just drops the injected
	// stylesheet. Read `app.indentGuides` first so the dependency registers even
	// while nothing is rendered yet (`diffContainer` is a plain `let`; renders
	// re-apply through onPostRender instead of waking this effect).
	$effect(() => {
		const enabled = app.indentGuides;
		const root = diffContainer?.shadowRoot;
		if (!root) return;
		if (enabled) applyIndentGuidesNow();
		else clearIndentGuides(root);
	});

	// Live-swap the diff theme when the app theme changes. `setThemeType` alone
	// only swaps the cached CSS overlay; the highlighter's token cache still
	// holds the previous theme's colors. `onThemeChange` clears that cache and
	// triggers a fresh render that picks up the new themeType.
	//
	// IMPORTANT: read `app.theme` *first* so Svelte registers it as a
	// dependency even on the early-mount pass when `instance` is still null.
	// `instance` is a plain `let` (not `$state`) so assigning it later doesn't
	// wake this effect — without reading the reactive value up-front, the
	// effect would orphan and never re-fire on theme changes.
	$effect(() => {
		const t = app.theme;
		// Whichever renderer is live (diff or raw) gets the new theme. Read `t`
		// first so the dependency registers even when both are null on first run.
		if (instance) {
			instance.setThemeType(t);
			instance.onThemeChange();
		}
		if (rawInstance) {
			rawInstance.setThemeType(t);
			rawInstance.onThemeChange();
		}
	});

	onDestroy(() => {
		cancelPendingRender?.();
		cancelPendingRender = null;
		cancelCalloutScroll?.();
		disposeDiff();
	});

	// Code/preview toggle. `showPreview` swaps the rendered diff for a rendered
	// view of the file: GitHub-flavored Markdown for `.md`, or the side-by-side
	// image for an SVG. Reset whenever the section is reused for a different file
	// (the {#each} recycles components).
	let showPreview = $state(false);
	const isMarkdown = $derived(isMarkdownPath(file.path));
	// Readable formats with a rendered view get a toggle button. Raster images
	// have no source to toggle to, so they're excluded (they always show the
	// image). SVGs qualify — they're text with a rendered form.
	const canPreview = $derived(
		(isMarkdown || isSvg) && !deferred && !placeholderMessage && !file.isBinary
	);
	// When to render the side-by-side ImageDiff instead of the source diff:
	// always for a raster image, and for an SVG while previewing.
	const showImageView = $derived(isImage && (file.isBinary || showPreview));
	// When to render the Markdown HTML instead of the source diff.
	const showMarkdownView = $derived(showPreview && isMarkdown);
	// Whether the source-diff host is on screen (not replaced by a preview). The
	// render effect gates on this so Pierre never paints into a hidden host.
	const hostVisible = $derived(!showMarkdownView && !showImageView);
	// Offer the Diff/Raw toggle for any text file with a source to show — i.e.
	// not a binary or raster image (those have no source view), not a deferred
	// (hidden/oversized) or placeholder diff (nothing fetched), and not while a
	// Markdown/image preview has taken over the source area.
	const canToggleRaw = $derived(
		!file.isBinary &&
			!isImage &&
			!deferred &&
			!placeholderMessage &&
			!showMarkdownView &&
			!showImageView
	);
	// Rendered preview HTML. Shiki highlighting is async, so we compute it in an
	// effect and stash the result instead of deriving synchronously. We keep the
	// previous HTML on screen while a re-render is in flight (e.g. theme change)
	// so the preview doesn't flash back to "Loading".
	let previewHtml = $state('');
	let previewRendering = $state(false);
	$effect(() => {
		if (!showPreview || !isMarkdown) {
			previewHtml = '';
			previewRendering = false;
			return;
		}
		const src = diffData?.newContents ?? '';
		const theme = app.theme;
		let cancelled = false;
		previewRendering = true;
		void renderMarkdown(src, theme)
			.then((html) => {
				if (!cancelled) previewHtml = html;
			})
			.catch(() => {
				if (!cancelled) previewHtml = '';
			})
			.finally(() => {
				if (!cancelled) previewRendering = false;
			});
		return () => {
			cancelled = true;
		};
	});
	// Plain (non-reactive) marker of the path we last reset for. We only want to
	// clear the toggle when a recycled section is pointed at a genuinely
	// different file — NOT every time the parent hands us a fresh `file` object
	// for the same path, which happens on each refresh and on window refocus.
	// Resetting on identity alone is what made the preview snap back to Code.
	let lastResetPath: string | undefined;
	$effect(() => {
		if (file.path !== lastResetPath) {
			lastResetPath = file.path;
			showPreview = false;
			showRaw = false;
			identicalSides = false;
		}
	});

	const isSeen = $derived(app.seenFiles.has(file.path));
	// The configurable "mark seen & next" binding, rendered on the button as a
	// discoverable hint for the keyboard path that does the same thing.
	const markSeenHotkey = $derived(
		formatHotkeyParts(app.hotkeys.markSeenNext, app.platform === 'darwin')
	);
	// The file header's badge, shown only where PR comments are in play
	// (`showCommentCount`). It spans both sources so it can't undercount a file
	// whose threads are a mix of the PR's and local ones left before it was opened.
	const commentCount = $derived(
		isPRContext
			? (app.prComments[file.path] ?? []).length +
					(isLocalCommentContext ? fileLocalComments.length : 0)
			: 0
	);
	const statusBadge = $derived.by(() => {
		switch (file.status) {
			case 'deleted':
				return 'deleted';
			case 'renamed':
				return 'renamed';
			default:
				return null;
		}
	});

	// "Mark seen" doubles as a "next file" affordance: marking collapses this
	// section and advances to the next change (shared with the Cmd/Ctrl+Enter
	// hotkey via the store). Un-marking is a passive edit — leave layout alone.
	function handleMarkSeen(): void {
		if (app.seenFiles.has(file.path)) {
			void actions.toggleSeen(file.path, false);
			return;
		}
		void actions.markSeenAndAdvance(file.path);
	}

	// Each entry in a file header's right-click menu: the pref key it toggles and
	// its label. Mirrors TopBar's header menu, but for the per-file controls.
	const fileHeaderMenuItems: { key: keyof FileHeaderItemVisibility; label: string }[] = [
		{ key: 'editor', label: 'Open in editor' },
		{ key: 'changedLines', label: 'Changed lines' },
		{ key: 'viewToggle', label: 'Raw / Diff toggle' },
		{ key: 'markSeen', label: 'Mark seen' }
	];

	// Right-click anywhere on a file header to customize which optional controls
	// show, via a native context menu. Each item is a checkbox reflecting its
	// current visibility; toggling one persists the new state for every file
	// header. A native menu closes on each click, so we apply the single item it
	// reports back.
	async function onFileHeaderContextMenu(e: MouseEvent): Promise<void> {
		e.preventDefault();
		const result = await window.api.menu.showFileHeaderContextMenu({
			items: fileHeaderMenuItems.map((it) => ({
				key: it.key,
				label: it.label,
				checked: app.fileHeaderItems[it.key]
			}))
		});
		if (result) actions.setFileHeaderItem(result.key, result.checked);
	}

	// Outdated comments can't be pinned inline — their line (or whole file) is gone
	// from the current diff — so we group them by thread and render them below the
	// diff from their stored hunk. GitHub keeps these unresolved, so we do too:
	// they show an "Outdated" badge but the resolved state stays driven by
	// `isResolved` alone (the resolve bar still renders via CommentAnnotation).
	const outdatedThreads = $derived.by<
		Array<{
			rootId: number;
			diffHunk?: string;
			comments: PRReviewComment[];
		}>
	>(() => {
		if (!isPRContext) return [];
		const all = app.prComments[file.path] ?? [];
		// Group outdated comments under their thread root, preserving first-seen
		// order. A live root with an outdated reply still groups here, anchored by
		// the root's hunk; only the outdated comments are rendered in the group.
		const threads: Array<{
			rootId: number;
			diffHunk?: string;
			comments: PRReviewComment[];
		}> = [];
		for (const c of all) {
			if (!c.isOutdated) continue;
			const rootId = c.inReplyTo ?? c.id;
			let thread = threads.find((t) => t.rootId === rootId);
			if (!thread) {
				const anchor = all.find((x) => x.id === rootId) ?? c;
				thread = {
					rootId,
					diffHunk: anchor.diffHunk,
					comments: []
				};
				threads.push(thread);
			}
			thread.comments.push(c);
		}
		return threads;
	});

	// Outdated threads are Svelte-rendered (not Pierre annotations), so they aren't
	// in `commentContainers` by default. Register each thread's container under
	// every key the sidebar might scroll to — the root and each comment — so a
	// "reveal" click lands on it. The element stays mounted while collapsed, so the
	// scroll target exists even before the thread is expanded.
	function registerOutdatedContainer(node: HTMLElement, keys: string[]) {
		let current = keys;
		for (const k of current) commentContainers.set(k, node);
		return {
			update(next: string[]): void {
				for (const k of current) commentContainers.delete(k);
				current = next;
				for (const k of current) commentContainers.set(k, node);
			},
			destroy(): void {
				for (const k of current) commentContainers.delete(k);
			}
		};
	}
</script>

<section
	bind:this={section}
	data-file-path={file.path}
	data-collapsed={!expanded}
	class={['border-b border-border', isLast && 'min-h-full']}
>
	<DiffFileHeader
		path={file.path}
		{expanded}
		onToggleExpanded={() => actions.toggleFileCollapsed(file.path)}
		{isSeen}
		{statusBadge}
		{commentCount}
		showCommentCount={isPRContext}
		additions={file.additions}
		deletions={file.deletions}
		isBinary={file.isBinary}
		showViewToggle={canToggleRaw}
		{showRaw}
		onShowRawChange={(raw) => (showRaw = raw)}
		onPrimeRaw={primeRawHighlight}
		{canPreview}
		{showPreview}
		{isSvg}
		onTogglePreview={() => (showPreview = !showPreview)}
		onOpenEditor={() => actions.openInEditor(file.path)}
		{markSeenHotkey}
		onMarkSeen={handleMarkSeen}
		onContextMenu={onFileHeaderContextMenu}
	/>

	<div class="bg-card/20" hidden={!expanded}>
		{#if renameFrom}
			<!-- The header only has room for the new path, so surface where the file
			     moved from here in the body where long paths can wrap. -->
			<div
				class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2 font-mono text-xs"
			>
				<span class="break-all text-muted-foreground">{renameFrom}</span>
				<span class="shrink-0 text-muted-foreground">→</span>
				<span class="break-all">{file.path}</span>
			</div>
		{/if}
		{#if showMarkdownView}
			{#if previewHtml}
				<!-- previewHtml is sanitized with DOMPurify in markdown.ts before it reaches here -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="markdown-body p-4">{@html previewHtml}</div>
			{:else if !diffData || previewRendering}
				<div class="p-4 text-xs text-muted-foreground">Loading preview…</div>
			{/if}
		{:else if showImageView}
			<ImageDiff
				name={file.path}
				oldSrc={diffData?.oldImage}
				newSrc={diffData?.newImage}
				loading={!diffData}
			/>
		{/if}
		<!-- Keep the diff host mounted (hidden) while previewing so the Pierre
         render machinery isn't torn down and rebuilt on every toggle. -->
		<div hidden={showMarkdownView || showImageView}>
			{#if placeholderMessage}
				<div class="p-4 text-sm text-muted-foreground">{placeholderMessage}</div>
			{:else if loadError}
				<div class="p-4 text-sm text-destructive">{loadError}</div>
			{:else if deferred && sessionManifestId}
				<SessionDiffCard
					sessionId={sessionManifestId}
					onViewRaw={() => (loadDiffOverride = true)}
				/>
			{:else if deferred && taskManifest}
				<TaskDiffCard onViewRaw={() => (loadDiffOverride = true)} />
			{:else if deferred}
				<div class="flex flex-col items-center gap-2 p-6 text-center">
					<p class="text-xs text-muted-foreground">
						{#if deferReason === 'pattern'}
							This file is hidden by default.{' '}
							<button
								type="button"
								class="text-primary underline underline-offset-2 hover:no-underline"
								onclick={() => actions.openSettingsDialog('behavior', 'hidden-files')}
							>
								Configure
							</button>
						{:else}
							This diff is too big to be displayed by default ({file.additions + file.deletions} changed
							lines).
						{/if}
					</p>
					<Button variant="outline" size="sm" onclick={() => (loadDiffOverride = true)}>
						Load diff
					</Button>
				</div>
			{:else if (loading || isAwaitingFirstRender) && !diffData?.file.isBinary}
				<div class="p-4 text-xs text-muted-foreground">Loading diff…</div>
			{:else if !inView && !diffData}
				<div
					class="grid place-items-center text-xs text-muted-foreground"
					style="min-height: {Math.min(400, (file.additions + file.deletions) * 18 + 48)}px"
				>
					<span class="opacity-50">Scroll to load</span>
				</div>
			{:else if diffData?.file.isBinary}
				<div class="p-4 text-sm text-muted-foreground">Binary file, diff not shown.</div>
			{:else if diffData?.truncated}
				<div class="p-4 text-sm text-muted-foreground">
					The diff for this file is too large to render.
				</div>
			{/if}
			<div bind:this={host} class="diff-host pl-2"></div>
			{#if outdatedThreads.length > 0}
				<div class="outdated-threads">
					{#each outdatedThreads as thread (thread.rootId)}
						<!-- Outdated threads are just normal comment threads: each comment
						     renders through CommentAnnotation (same background/padding/collapse
						     as every other comment). The only extra is the saved diff hunk,
						     handed to the root so it renders the code context inside the comment
						     body. The wrapper only exists to (a) inset the thread to where the
						     gutter would put an inline comment and (b) register the container so
						     a sidebar "reveal" can scroll to it. -->
						<div
							class="outdated-thread"
							use:registerOutdatedContainer={[
								`pr-${thread.rootId}`,
								...thread.comments.map((c) => `pr-${c.id}`)
							]}
						>
							{#each thread.comments as c (c.id)}
								<CommentAnnotation
									meta={{ kind: 'comment', comment: c }}
									diffHunk={c.inReplyTo ? undefined : thread.diffHunk}
								/>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</section>

<style>
	.diff-host :global(diffs-container) {
		display: block;
		width: 100%;
	}
	/* Kill the strip Pierre reserves along the bottom of every diff: its scroll
	   element defaults to `overflow: scroll` (a permanently-visible horizontal
	   scrollbar) plus `scrollbar-gutter: stable` (space reserved even with no
	   scrollbar). With always-on OS scrollbars that shows as a dark bar/padding
	   under the last line. `auto` overflow + `auto` gutter means the scrollbar (and
	   its reserved space) only appear when a line actually overflows. */
	.diff-host {
		--diffs-overflow-override: auto;
	}
	.diff-host :global([data-code]) {
		scrollbar-gutter: auto;
		/* Pierre keeps a `gap-block` sliver of bottom padding (minus the scrollbar
		   gutter). Zero it so the last line sits flush; the top padding is untouched. */
		padding-bottom: 0;
	}
	/* Inset the outdated comment thread to where the line-number gutter would put
	   an inline comment annotation, so it lines up with normal comments instead of
	   spanning flush-left like code. Approximates the gutter width. */
	.outdated-thread {
		padding-left: 2.5rem;
	}
	/* Pierre's `+` gutter button and its slot live inside Pierre's shadow DOM,
     which these scoped light-DOM rules can't reach. Their styling and centering
     is in GUTTER_UTILITY_CSS above, injected via Pierre's `unsafeCSS`. */
</style>
