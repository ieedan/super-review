<script lang="ts">
	import { mount, unmount, onDestroy, onMount } from 'svelte';
	import {
		Check,
		ChevronDown,
		ChevronRight,
		Code,
		Code2,
		Eye,
		FileText,
		Image as ImageIcon
	} from 'lucide-svelte';
	import Icon from '@iconify/svelte/dist/OfflineIcon.svelte';
	import CursorIcon from './icons/CursorIcon.svelte';
	import VSCodeIcon from './icons/VSCodeIcon.svelte';
	import XcodeIcon from './icons/XcodeIcon.svelte';
	import ZedIcon from './icons/ZedIcon.svelte';
	import VisualStudioIcon from './icons/VisualStudioIcon.svelte';
	import { languageIconForPath } from '$lib/file-icons';
	import { truncatePathPrefix } from '$lib/path-truncate';
	import { isMarkdownPath, renderMarkdown } from '$lib/markdown';
	import { isImagePath, isSvgPath } from '@shared/media';
	import ImageDiff from './ImageDiff.svelte';
	import '$lib/markdown.css';
	import {
		DIFFS_TAG_NAME,
		FileDiff as FileDiffClass,
		parseDiffFromFile,
		type DiffLineAnnotation,
		type OnDiffLineClickProps,
		type SelectedLineRange
	} from '@pierre/diffs';
	import { Button } from './ui/button';
	import { Badge } from './ui/badge';
	import { formatHotkeyParts } from '@shared/hotkeys';
	import {
		actions,
		app,
		composerKey,
		effectiveEditor,
		getCachedDiff,
		isReadOnlyView,
		setCachedDiff
	} from '$lib/store.svelte';
	import { diffDeferReason } from '@shared/diff-defer';
	import { getDiffWorkerPool } from '$lib/diff-worker-pool';
	import { scheduleRender } from '$lib/render-scheduler';
	import { diffContextKey } from '@shared/diff-context';
	import {
		changedLineKeys,
		parseFilePatch,
		stagingLineKey,
		type DiffSide
	} from '@shared/diff-staging';
	import { registerFindSection, notifySectionState } from '$lib/diff-find.svelte';
	import CommentAnnotation, { type CommentMeta } from './CommentAnnotation.svelte';
	import LocalCommentAnnotation, { type LocalCommentMeta } from './LocalCommentAnnotation.svelte';
	import CalloutAnnotation from './CalloutAnnotation.svelte';
	import { calloutsForFile } from '$lib/session-tour';
	import type {
		ChangedFile,
		DiffContext,
		DiffData,
		EditorKind,
		LocalComment,
		PRReviewComment,
		SessionCallout
	} from '@shared/types';

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
	// A pure rename (or copy) with no content change has nothing to diff — git
	// reports zero additions/deletions. Mirror GitHub and show a one-liner
	// instead of fetching/rendering an empty diff.
	const renamedNoChanges = $derived(
		(file.status === 'renamed' || file.status === 'copied') &&
			file.additions === 0 &&
			file.deletions === 0
	);
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
	const isDeleted = $derived(file.status === 'deleted');
	// Image files are rendered side by side (raster) or get a code/image toggle
	// (SVG), so the usual "renamed"/"deleted" one-liners don't apply — we still
	// want to show the old image of a deleted image, etc.
	const isImage = $derived(isImagePath(file.path));
	const isSvg = $derived(isSvgPath(file.path));
	// Files where the diff body is pointless to render — show a one-liner.
	const placeholderMessage = $derived(
		isImage
			? null
			: renamedNoChanges
				? 'File renamed without changes.'
				: isDeleted
					? 'This file was deleted.'
					: null
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

	// Local review comments apply in every context that isn't surfacing PR
	// comments — the working tree, a branch diff with no PR, a session's changes,
	// a stash. Their line numbers are anchored to whatever diff is on screen and
	// stored under that context's key, so they never collide with PR comments.
	const isLocalCommentContext = $derived(!isPRContext);

	// Whether Pierre's gutter `+` affordance should be live: any context where a
	// click produces a comment (PR or local).
	const canComment = $derived(isPRContext || isLocalCommentContext);

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

		for (const c of localComments) {
			let meta = localCommentMetaCache.get(c.id);
			// Invalidate when the comment object was replaced (e.g. resolved).
			if (meta == null || meta.comment !== c) {
				meta = { kind: 'local-comment', comment: c };
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
	$effect(() => {
		if (!section) return;
		const unregister = registerFindSection(file.path, section, {
			renderIfNeeded: forceRenderForFind
		});
		return unregister;
	});

	// Mirror `inView` into the find controller so it knows which file sections
	// have live DOM to paint yellow "all-match" highlights into. Out-of-view
	// sections get their highlights dropped.
	$effect(() => {
		notifySectionState(file.path, { inView });
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
		if (instance) {
			try {
				instance.cleanUp();
			} catch {
				// ignore
			}
			instance = null;
		}
		// The staging click listener lives on the shadow root that's about to be
		// destroyed with the container; drop our reference (and detach defensively).
		if (stagingClickRoot) {
			stagingClickRoot.removeEventListener('click', onStagingClick);
			stagingClickRoot = null;
		}
		staging = null;
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
			stagingClickRoot?.removeEventListener('click', onStagingClick);
			stagingClickRoot?.removeEventListener('contextmenu', onStagingContextMenu);
			root.addEventListener('click', onStagingClick);
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
			e.stopPropagation();
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
			e.stopPropagation();
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

	function renderDiff(diff: DiffData): void {
		if (!host) return;
		disposeDiff();
		if (diff.file.isBinary) return;

		// Build the per-hunk staging model from the raw git patch up front so the
		// gutter checkboxes can be injected as soon as Pierre finishes rendering.
		staging = stagingEnabled && diff.patch ? buildStagingModel(diff.patch) : null;

		diffContainer = document.createElement(DIFFS_TAG_NAME);
		// `host` is ours and Svelte doesn't manage its children — Pierre renders
		// into this element, so the manual append is intentional.
		// eslint-disable-next-line svelte/no-dom-manipulating
		host.appendChild(diffContainer);
		instance = new FileDiffClass<AnnotationMeta>(
			{
				diffStyle: app.viewMode,
				themeType: app.theme,
				disableFileHeader: true,
				renderAnnotation,
				onLineNumberClick: onDiffLineNumberClick,
				// Built-in gutter `+` button (the one with `data-utility-button`).
				// Only enable it where commenting is meaningful — toggled live below
				// via setOptions + flushManagers when `canComment` changes.
				enableGutterUtility: canComment,
				onGutterUtilityClick: onGutterClick,
				// Inject the staging gutters after every (re)render. Pierre rebuilds
				// its shadow DOM on render and on the worker's async highlight
				// rerender, so re-apply each time.
				onPostRender: applyStagingControls
			},
			// Highlight + diff-AST work runs on the shared worker pool so the main
			// thread stays responsive; FileDiff paints plain text first, then
			// rerenders when the worker returns the highlighted AST. Falls back to
			// the main-thread highlighter when the pool is unavailable.
			getDiffWorkerPool()
		);

		const namePair = {
			old: diff.file.oldPath ?? diff.file.path,
			new: diff.file.path
		};
		const oldFile = { name: namePair.old, contents: diff.oldContents };
		const newFile = { name: namePair.new, contents: diff.newContents };

		let metadata;
		try {
			metadata = parseDiffFromFile(oldFile, newFile);
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
			return;
		}
		if (!metadata) return;

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
		loadedCtxKey && diffData ? `${loadedCtxKey}::${app.viewMode}::${dataEpoch}` : null
	);

	// True when there's no DOM in the host yet for the current data — the
	// placeholder uses this to keep "Loading diff…" visible across the gap
	// between data landing and the scheduler actually running renderDiff.
	const isAwaitingFirstRender = $derived(targetRenderKey !== null && renderedKey === null);

	function setLoadedDiff(d: DiffData, ctxKey: string): void {
		diffData = d;
		loadedCtxKey = ctxKey;
		dataEpoch++;
		// The find index reads from the diff cache; signal it that new patch
		// text just landed so any active query can incorporate this file.
		notifySectionState(file.path, { dataLoaded: true });
	}

	function clearLoadedDiff(): void {
		diffData = null;
		loadedCtxKey = null;
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
		const target = `${ctxKey}::${app.viewMode}::${dataEpoch}`;
		if (renderedKey === target) return true;
		cancelPendingRender?.();
		cancelPendingRender = null;
		renderDiff(data);
		renderedKey = target;
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

	// Fetch the diff the first time the section enters view (and stays expanded).
	// Hydrates from the cross-tab diff cache when available so switching back
	// to a context renders instantly, then refreshes in the background. The
	// actual DOM render is kicked off by the render effect below.
	$effect(() => {
		// Read both tokens first so the effect re-runs when an op forces a reload
		// or a focus/poll refresh asks open sections to re-validate against disk.
		const reloadToken = app.diffReloadToken;
		const revalidateToken = app.diffRevalidateToken;
		if (!inView || !expanded || !app.activeRepo) return;
		// Don't fetch hidden diffs — wait until the user clicks "Load diff". When
		// they do, `deferred` flips false and this effect re-runs to fetch.
		if (deferred) return;
		// Nothing useful to render for a pure rename or a deletion.
		if (placeholderMessage) return;
		const repo = app.activeRepo;
		const ctx = $state.snapshot(app.diffContext) as DiffContext;
		const ctxKey = diffContextKey(ctx);
		// A bumped reload token means this file was rewritten in place — re-fetch
		// even though the context matches what's already loaded.
		const forced = reloadToken !== appliedReloadToken;
		// A bumped revalidate token means files may have changed on disk outside
		// the app; re-fetch in the background but keep the current diff on screen.
		const revalidate = revalidateToken !== appliedRevalidateToken;
		// Already up to date for this context with nothing asking us to refresh,
		// or a (non-forced) fetch is already in flight.
		if (diffData && loadedCtxKey === ctxKey && !forced && !revalidate) return;
		if (loading && !forced) return;
		appliedReloadToken = reloadToken;
		appliedRevalidateToken = revalidateToken;

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
		if (!instance) return;
		instance.setThemeType(t);
		instance.onThemeChange();
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
	const pathDir = $derived(
		file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''
	);
	const pathBase = $derived(
		file.path.includes('/') ? file.path.slice(file.path.lastIndexOf('/') + 1) : file.path
	);
	// Center-style path truncation for the sticky header label, matching the
	// sidebar's changes list: keep the full filename and shrink only the
	// directory prefix (so the most-significant part stays visible) instead of
	// chopping the tail with a CSS ellipsis. We measure the label's available
	// width (it's the sole flex-grow child of its wrapper, so its box width is
	// decoupled from the truncated text — no measure/shrink feedback loop) and
	// hand it to the same pretext-based helper the sidebar uses.
	let pathEl = $state<HTMLElement | null>(null);
	let pathWidth = $state(0);
	let pathFont = $state('12px ui-monospace, monospace');
	// The label is rendered unconditionally in the header, so its element exists
	// for the whole life of the section: set the observer up once on mount and
	// tear it down on destroy. The ResizeObserver handles width changes; we don't
	// need an $effect to re-sync on reactive state.
	onMount(() => {
		const el = pathEl;
		if (!el) return;
		const measure = (): void => {
			pathWidth = el.clientWidth;
			const cs = window.getComputedStyle(el);
			// text-xs is 12px in Tailwind; pair it with the label's resolved
			// (monospace) family for a canvas-compatible font shorthand.
			pathFont = `${cs.fontWeight} 12px ${cs.fontFamily}`;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});
	const displayPrefix = $derived(
		pathDir ? truncatePathPrefix(pathDir, pathBase, pathWidth, pathFont) : ''
	);
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
		}
	});

	const isSeen = $derived(app.seenFiles.has(file.path));
	// The configurable "mark seen & next" binding, rendered on the button as a
	// discoverable hint for the keyboard path that does the same thing.
	const markSeenHotkey = $derived(
		formatHotkeyParts(app.hotkeys.markSeenNext, app.platform === 'darwin')
	);
	const commentCount = $derived(isPRContext ? (app.prComments[file.path] ?? []).length : 0);
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

	// Mirrors the toolbar's EditorButton, but opens this specific file rather
	// than the repo root.
	const editor = $derived<EditorKind | null>(effectiveEditor());
	const anyEditorAvailable = $derived(
		app.editors.cursor ||
			app.editors.vscode ||
			app.editors.zed ||
			app.editors.xcode ||
			app.editors.visualstudio
	);
	const editorLabels: Record<EditorKind, string> = {
		cursor: 'Cursor',
		vscode: 'Visual Studio Code',
		zed: 'Zed',
		xcode: 'Xcode',
		visualstudio: 'Visual Studio'
	};

	// Surface comments that fall outside the rendered diff (e.g. on lines we
	// skipped) so they aren't silently lost.
	const orphanComments = $derived.by<PRReviewComment[]>(() => {
		if (!isPRContext) return [];
		return (app.prComments[file.path] ?? []).filter((c) => c.line == null);
	});
</script>

<section
	bind:this={section}
	data-file-path={file.path}
	class={['border-b border-border', isLast && 'min-h-full']}
>
	<header
		class={[
			'sticky top-0 z-10 flex h-11 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur'
		]}
	>
		<button
			type="button"
			class="grid size-5 shrink-0 place-items-center rounded hover:bg-accent"
			onclick={() => actions.toggleFileCollapsed(file.path)}
			aria-label={expanded ? 'Collapse' : 'Expand'}
		>
			{#if expanded}
				<ChevronDown class="size-3.5" />
			{:else}
				<ChevronRight class="size-3.5" />
			{/if}
		</button>
		<Icon icon={languageIconForPath(file.path)} class="size-3.5 shrink-0" />
		<div class="flex min-w-0 flex-1 items-center gap-2">
			<!-- Inline whitespace is intentional (see FileList.svelte): a newline
			     between these flex children renders as a visible gap between the
			     truncated prefix and the filename. `displayPrefix` is pre-fit by
			     pretext, so the label only needs overflow-hidden as a guard. -->
			<span
				bind:this={pathEl}
				class={[
					'flex min-w-0 flex-1 items-center overflow-hidden font-mono text-xs whitespace-nowrap',
					isSeen && 'text-muted-foreground'
				]}
				title={file.path}
				>{#if displayPrefix}<span class={[!isSeen && 'text-muted-foreground']}>{displayPrefix}</span
					>{/if}<span class="shrink-0">{pathBase}</span></span
			>
			{#if statusBadge}
				<Badge variant={statusBadge === 'deleted' ? 'destructive' : 'warning'}>
					{statusBadge}
				</Badge>
			{/if}
			{#if file.isBinary}
				<Badge variant="muted">binary</Badge>
			{/if}
			{#if isPRContext && commentCount > 0}
				<Badge variant="muted">{commentCount} comment{commentCount === 1 ? '' : 's'}</Badge>
			{/if}
		</div>
		<div class="flex items-center gap-2 text-[10px] tabular-nums">
			{#if !file.isBinary}
				{#if file.additions > 0}
					<span class="text-success">+{file.additions}</span>
				{/if}
				{#if file.deletions > 0}
					<span class="text-destructive">−{file.deletions}</span>
				{/if}
			{/if}
			{#if anyEditorAvailable}
				<Button
					variant="ghost"
					size="icon-sm"
					onclick={() => actions.openInEditor(file.path)}
					title={editor ? `Open in ${editorLabels[editor]}` : 'Open in editor'}
				>
					{#if editor === 'cursor'}
						<CursorIcon class="size-3.5" />
					{:else if editor === 'vscode'}
						<VSCodeIcon class="size-3.5" />
					{:else if editor === 'zed'}
						<ZedIcon class="size-3.5" />
					{:else if editor === 'xcode'}
						<XcodeIcon class="size-3.5" />
					{:else if editor === 'visualstudio'}
						<VisualStudioIcon class="size-3.5" />
					{:else}
						<Code2 class="size-3.5" />
					{/if}
				</Button>
			{/if}
			{#if canPreview}
				<Button
					variant={showPreview ? 'secondary' : 'outline'}
					size="sm"
					onclick={() => (showPreview = !showPreview)}
				>
					{#if showPreview}
						<Code class="size-3.5" /> Code
					{:else if isSvg}
						<ImageIcon class="size-3.5" /> Image
					{:else}
						<FileText class="size-3.5" /> Preview
					{/if}
				</Button>
			{/if}
			<Button variant={isSeen ? 'secondary' : 'outline'} size="sm" onclick={handleMarkSeen}>
				{#if isSeen}
					<Check class="size-3.5" /> Seen
				{:else}
					<Eye class="size-3.5" /> Mark seen
					<span class="ml-1 text-muted-foreground">{markSeenHotkey.join('')}</span>
				{/if}
			</Button>
		</div>
	</header>

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
					File too large to render. Diff preview disabled.
				</div>
			{/if}
			<div bind:this={host} class="diff-host pl-2"></div>
			{#if orphanComments.length > 0}
				<div class="border-t border-border p-3 text-xs text-muted-foreground">
					<p class="mb-2 font-medium">
						{orphanComments.length} comment{orphanComments.length === 1 ? '' : 's'} on outdated lines:
					</p>
					<ul class="space-y-2">
						{#each orphanComments as c (c.id)}
							<li class="rounded border border-border bg-card/40 p-2">
								<div class="font-medium">{c.author}</div>
								<p class="whitespace-pre-wrap">{c.body}</p>
							</li>
						{/each}
					</ul>
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
	/* Pierre's gutter container sits absolute over the line-number cell with
     no z-index. Raise it above the digits and let it fill the gutter so the
     `+` button has a solid backdrop. */
	.diff-host :global([data-gutter-utility-slot]) {
		z-index: 5;
		left: 0;
		right: 0;
		align-items: center;
		justify-content: center;
		background: var(--diffs-bg-num, var(--diffs-bg, transparent));
	}
	/* Pierre's built-in `+` button (with `data-utility-button`). Reskin to
     match the project's default Button variant — primary bg, white icon,
     rounded, with a soft elevation so it pops against the diff line. */
	.diff-host :global([data-utility-button]) {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: hsl(var(--primary));
		color: hsl(var(--primary-foreground));
		cursor: pointer;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.25),
			0 0 0 1px rgba(0, 0, 0, 0.04);
		transition:
			transform 80ms ease,
			box-shadow 80ms ease,
			background-color 80ms ease;
	}
	.diff-host :global([data-utility-button]:hover) {
		background: color-mix(in lab, hsl(var(--primary)) 90%, white);
		transform: scale(1.06);
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.25),
			0 0 0 1px rgba(0, 0, 0, 0.05);
	}
	.diff-host :global([data-utility-button]:focus-visible) {
		outline: 2px solid hsl(var(--ring));
		outline-offset: 1px;
	}
	.diff-host :global([data-utility-button] svg) {
		width: 12px;
		height: 12px;
		stroke-width: 2.5;
	}
</style>
