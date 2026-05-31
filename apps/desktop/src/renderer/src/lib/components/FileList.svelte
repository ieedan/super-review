<script lang="ts">
	import {
		ArrowLeft,
		Check,
		ChevronRight,
		FileMinus,
		FileEdit,
		Folder,
		FolderOpen,
		List,
		FolderTree,
		MessageSquare,
		Minus,
		PanelLeft,
		Search,
		X
	} from 'lucide-svelte';
	import Icon from '@iconify/svelte/dist/OfflineIcon.svelte';
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';
	import { Button } from './ui/button';
	import { Kbd } from './ui/kbd';
	import * as Tabs from './ui/tabs';
	import * as Sidebar from './ui/sidebar';
	import CommitBox from './CommitBox.svelte';
	import SessionsList from './SessionsList.svelte';
	import SessionTour from './SessionTour.svelte';
	import HarnessLogo from './HarnessLogo.svelte';
	import { harnessLabel } from '$lib/harness-logos';
	import { actions, app, type ContextTab } from '$lib/store.svelte';
	import { cn } from '$lib/utils';
	import { languageIconForPath } from '$lib/file-icons';
	import { truncatePathPrefix } from '$lib/path-truncate';
	import { matchesFileQuery } from '$lib/file-search';
	import { matchesHotkey } from '@shared/hotkeys';
	import type { ChangedFile } from '@shared/types';

	// Right-clicking a file row opens a native OS context menu (built in the main
	// process). preventDefault stops the default browser menu from also showing.
	function onRowContextMenu(e: MouseEvent, file: ChangedFile): void {
		e.preventDefault();
		// Right-clicking a row outside the current multi-selection collapses the
		// selection onto it (Finder/VSCode behavior); right-clicking within the
		// selection keeps it so the menu can act on the whole set.
		if (!app.selectedFiles.has(file.path)) {
			selectionAnchor = file.path;
			actions.setSelectedFiles([file.path]);
		}
		void actions.showFileContextMenu(file);
	}

	type Node =
		| {
				kind: 'folder';
				path: string;
				// Display name. With compact folders on, a chain of single-child
				// folders is shown as one row, so this can be a joined path like
				// `src/lib/components`.
				name: string;
				depth: number;
				childCount: number;
				// Every changed file beneath this folder (any depth). Drives the
				// folder's tri-state commit checkbox in the Unstaged tab.
				filePaths: string[];
		  }
		| {
				kind: 'file';
				path: string;
				name: string;
				// GitHub-style muted directory prefix shown before `name`. Only set in
				// 'list' layout, where the whole path is shown on a single row.
				dirPrefix?: string;
				depth: number;
				file: ChangedFile;
		  };

	// Tight, uniform row height for the virtualizer. Each row enforces this
	// with `style="height: ${ROW_HEIGHT}px"` + `items-center` so the math
	// (start/end index from scrollTop) stays exact regardless of content.
	const ROW_HEIGHT = 22;
	// Off-screen rows kept mounted on either side of the viewport so a quick
	// wheel flick or arrow scroll doesn't reveal blank rows before the next
	// animation frame fills them in.
	const BUFFER_ROWS = 8;

	// Filter changed files by the shared search query. Supports plain substring
	// matching and glob patterns like `*.svelte` (see matchesFileQuery). When the
	// query is empty, this is the full list. The query lives on the store so the
	// diff view applies the same filter.
	const filteredFiles = $derived.by<ChangedFile[]>(() => {
		const q = app.fileSearchQuery.trim();
		if (!q) return app.changedFiles;
		return app.changedFiles.filter((f) => matchesFileQuery(f.path, q));
	});

	// The list/tree layout is tracked per sidebar tab, so the active tab decides
	// which persisted setting drives the node layout (and the toggle below).
	// 'sessions' has no file list; it falls back to the unstaged layout.
	const fileListLayout = $derived(
		app.contextTab === 'branch' ? app.branchFileListLayout : app.unstagedFileListLayout
	);
	const isTreeLayout = $derived(fileListLayout === 'tree');

	// An open session with a tour offers Tour / Changes sub-tabs. Without steps
	// there's no tour, so it behaves like a plain changes review.
	const sessionHasSteps = $derived((app.activeSessionDetail?.steps?.length ?? 0) > 0);
	// The Tour view owns its own navigation; everything else (normal tabs, a
	// session's Changes view, a stepless session) gets the file search + the
	// tree/list toggle.
	const showFileControls = $derived(
		app.contextTab !== 'sessions' ||
			(app.activeSessionId != null && (!sessionHasSteps || app.sessionView === 'changes'))
	);
	const showSessionTour = $derived(
		app.activeSessionId != null && sessionHasSteps && app.sessionView === 'tour'
	);

	// Build the visible flat list of nodes from the changed files. In 'tree'
	// layout, folders are aggregated from the file paths themselves and may be
	// collapsed. In 'list' layout, each file gets its own row at depth 0 with
	// its full path as the display name — no folder rows.
	const nodes = $derived.by<Node[]>(() => {
		if (fileListLayout === 'list') {
			const out: Node[] = [];
			for (const f of filteredFiles) {
				const slash = f.path.lastIndexOf('/');
				// Fold the path separator into the filename (`/CreateBranchDialog.svelte`)
				// so the row only needs two flex children — a truncating prefix and a
				// shrink-0 filename. With three children (prefix + slash span + name),
				// when the truncate span shrinks small enough, Chromium's text-overflow
				// can leave a few subpixels of empty space between the ellipsis and
				// the next flex item, which read as a visible gap.
				const dirPrefix = slash >= 0 ? f.path.slice(0, slash) : '';
				const name = slash >= 0 ? f.path.slice(slash) : f.path;
				out.push({
					kind: 'file',
					path: f.path,
					name,
					dirPrefix,
					depth: 0,
					file: f
				});
			}
			return out;
		}

		// While searching, ignore collapsed folders so matches deep in the tree
		// are always visible without forcing the user to expand parents.
		const isSearching = app.fileSearchQuery.trim().length > 0;
		const collapsed = isSearching ? new Set<string>() : app.collapsedFolders;

		// Build a real folder tree from the file paths. The store already sorts
		// app.changedFiles VSCode-style, so Map insertion order (first-seen) keeps
		// folders and files in sorted order at every level.
		type Tmp = {
			path: string;
			// Display segments. Compaction appends a single child's segments here so
			// `src` + `lib` + `components` renders as one `src/lib/components` row.
			segments: string[];
			folders: Map<string, Tmp>;
			files: ChangedFile[];
			// All descendant file paths, filled in by annotate().
			filePaths: string[];
		};
		const root: Tmp = {
			path: '',
			segments: [],
			folders: new Map(),
			files: [],
			filePaths: []
		};
		for (const f of filteredFiles) {
			const parts = f.path.split('/');
			const dirs = parts.slice(0, -1);
			let cur = root;
			let acc = '';
			for (const d of dirs) {
				acc = acc ? `${acc}/${d}` : d;
				let next = cur.folders.get(d);
				if (!next) {
					next = {
						path: acc,
						segments: [d],
						folders: new Map(),
						files: [],
						filePaths: []
					};
					cur.folders.set(d, next);
				}
				cur = next;
			}
			cur.files.push(f);
		}

		// Compact folders (VSCode-style): a folder holding nothing but a single
		// subfolder is merged into that child, so deep single-child chains collapse
		// into one row. Done bottom-up so chains of any length fold fully.
		function compact(folder: Tmp): void {
			for (const child of folder.folders.values()) compact(child);
			while (folder.files.length === 0 && folder.folders.size === 1) {
				const child = folder.folders.values().next().value as Tmp;
				folder.segments = [...folder.segments, ...child.segments];
				folder.path = child.path;
				folder.files = child.files;
				folder.folders = child.folders;
			}
		}
		// Cache each folder's descendant file paths for its commit checkbox.
		function annotate(folder: Tmp): string[] {
			const paths = folder.files.map((f) => f.path);
			for (const child of folder.folders.values()) paths.push(...annotate(child));
			folder.filePaths = paths;
			return paths;
		}
		for (const child of root.folders.values()) {
			compact(child);
			annotate(child);
		}

		// Flatten to the virtualized row list: subfolders first (sorted), then
		// files, recursing into expanded folders only.
		const out: Node[] = [];
		function walk(folder: Tmp, depth: number): void {
			for (const sub of folder.folders.values()) {
				out.push({
					kind: 'folder',
					path: sub.path,
					name: sub.segments.join('/'),
					depth,
					childCount: sub.filePaths.length,
					filePaths: sub.filePaths
				});
				if (!collapsed.has(sub.path)) walk(sub, depth + 1);
			}
			for (const f of folder.files) {
				const parts = f.path.split('/');
				out.push({
					kind: 'file',
					path: f.path,
					name: parts[parts.length - 1],
					depth,
					file: f
				});
			}
		}
		walk(root, 0);
		return out;
	});

	const totals = $derived.by(() => {
		let add = 0,
			del = 0;
		for (const f of app.changedFiles) {
			add += f.additions;
			del += f.deletions;
		}
		return { add, del };
	});

	const seenCount = $derived(app.changedFiles.filter((f) => app.seenFiles.has(f.path)).length);

	// Commit-inclusion state for the Unstaged tab. A file is included unless the
	// user has explicitly unchecked it (tracked as an exclusion set on the
	// store), so newly-changed files start checked.
	const includedCount = $derived(
		app.changedFiles.filter((f) => !app.excludedFromCommit.has(f.path)).length
	);
	const allIncluded = $derived(
		app.changedFiles.length > 0 && includedCount === app.changedFiles.length
	);
	const someIncluded = $derived(includedCount > 0 && !allIncluded);

	// Animate the header counters ticking toward their new values when animations
	// are enabled. Each Tween's `target` is driven by the underlying derived
	// value; with animations off we collapse the duration to 0 so the number
	// snaps instantly. `current` is fractional mid-flight, so the display values
	// round to whole integers.
	const seenTween = new Tween(0, { duration: 400, easing: cubicOut });
	const addTween = new Tween(0, { duration: 400, easing: cubicOut });
	const delTween = new Tween(0, { duration: 400, easing: cubicOut });
	$effect(() => {
		const duration = app.animationsEnabled ? 400 : 0;
		void seenTween.set(seenCount, { duration });
		void addTween.set(totals.add, { duration });
		void delTween.set(totals.del, { duration });
	});
	const seenDisplay = $derived(Math.round(seenTween.current));
	const addDisplay = $derived(Math.round(addTween.current));
	const delDisplay = $derived(Math.round(delTween.current));

	function pick(path: string): void {
		focusedPath = path;
		selectionAnchor = path;
		// Plain open (click / keyboard) collapses any multi-selection to this file.
		actions.selectOnly(path);
	}

	// Anchor for shift-click range selection — the row a range extends from.
	// Set on every plain or cmd click so the next shift-click knows where to
	// start. Null until the user has clicked a file.
	let selectionAnchor = $state<string | null>(null);

	// The file paths between two rows (inclusive), in the order they're shown in
	// the current tree/list layout. Folder rows are skipped so a range only ever
	// covers files. Backs shift-click range selection.
	function filePathsBetween(a: string, b: string): string[] {
		const files = nodes.filter((n) => n.kind === 'file');
		const ia = files.findIndex((n) => n.path === a);
		const ib = files.findIndex((n) => n.path === b);
		if (ia === -1 || ib === -1) return [b];
		const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
		return files.slice(lo, hi + 1).map((n) => n.path);
	}

	// The closest still-selected file row to `from`, searching forward first and
	// then backward through the visible list. Used when deselecting the open file
	// to pick what to show next. Returns null when nothing else is selected.
	function nearestSelectedFile(from: string): string | null {
		const files = nodes.filter((n) => n.kind === 'file');
		const i = files.findIndex((n) => n.path === from);
		if (i === -1) return null;
		for (let j = i + 1; j < files.length; j++) {
			if (app.selectedFiles.has(files[j].path)) return files[j].path;
		}
		for (let j = i - 1; j >= 0; j--) {
			if (app.selectedFiles.has(files[j].path)) return files[j].path;
		}
		return null;
	}

	// Click handling for a file row, honoring GitHub-Desktop-style modifiers:
	//  • shift-click  → select the range from the anchor to this row
	//  • cmd/ctrl-click → toggle this row in/out of the selection (no navigation)
	//  • plain click  → select just this row (collapses any multi-selection)
	// Shift- and plain clicks open the clicked file's diff; cmd/ctrl-click only
	// adjusts the selection so deselecting a row doesn't yank you to it.
	function onFileClick(e: MouseEvent, file: ChangedFile): void {
		if (e.shiftKey && selectionAnchor) {
			actions.setSelectedFiles(filePathsBetween(selectionAnchor, file.path));
			focusedPath = file.path;
			actions.scrollToFile(file.path);
		} else if (e.metaKey || e.ctrlKey) {
			// Deselecting the row whose diff is currently open: move to the nearest
			// remaining selected row so we don't keep showing a deselected file. If
			// nothing stays selected, leave the diff as-is.
			const deselectingOpen = app.selectedFiles.has(file.path) && app.selectedFile === file.path;
			actions.toggleSelectedFile(file.path);
			selectionAnchor = file.path;
			focusedPath = file.path;
			if (deselectingOpen) {
				const next = nearestSelectedFile(file.path);
				if (next) {
					focusedPath = next;
					actions.scrollToFile(next);
				}
			}
		} else {
			pick(file.path);
		}
	}

	// Keyboard cursor over the visible flat `nodes` list. Can point at a file OR a
	// folder, independent of `app.selectedFile` (the open file). When
	// `openFileOnArrowNav` is on, moving the cursor onto a file also opens it, so
	// the two usually coincide; in "Enter to open" mode the ring moves freely and
	// Enter/Space commits.
	let focusedPath = $state<string | null>(null);

	// Resolve the cursor's row index, falling back to the open file's row, then
	// the top of the list.
	function currentFocusIndex(): number {
		if (focusedPath) {
			const i = nodes.findIndex((n) => n.path === focusedPath);
			if (i !== -1) return i;
		}
		if (app.selectedFile) {
			const i = nodes.findIndex((n) => n.kind === 'file' && n.path === app.selectedFile);
			if (i !== -1) return i;
		}
		return 0;
	}

	// Move the cursor to a row. Landing on a file opens its diff when
	// `openFileOnArrowNav` is enabled; folders only ever receive the ring.
	function focusNode(index: number): void {
		const node = nodes[index];
		if (!node) return;
		if (node.kind === 'file' && app.openFileOnArrowNav) {
			pick(node.path);
		} else {
			focusedPath = node.path;
		}
	}

	// Move the cursor to the next/previous file (skipping folder rows) starting
	// from `i` and stepping in `dir`. Used by the Option/Alt + Up/Down shortcut.
	function focusFileFrom(i: number, dir: 1 | -1): void {
		for (let j = i + dir; j >= 0 && j < nodes.length; j += dir) {
			if (nodes[j].kind === 'file') {
				focusNode(j);
				return;
			}
		}
	}

	// Arrow-key navigation over the tree. Bound to the scroll region (see the
	// scrollRoot effect) so it only fires when the file list is focused and never
	// steals arrow-scroll from the diff pane.
	function onTreeKeydown(e: KeyboardEvent): void {
		const target = e.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		) {
			return;
		}
		// Leave meta/ctrl combos to app/global shortcuts. Alt is handled below.
		if (e.metaKey || e.ctrlKey) return;
		if (nodes.length === 0) return;

		// Once we know this is a navigation key, pull DOM focus onto the stable
		// scroll container. Row buttons get unmounted by virtualization as they
		// scroll out of view; if focus stayed on one, the keydown would stop
		// bubbling to this handler and arrow keys would fall back to plain
		// scrolling. The container never unmounts, so focus survives navigation.
		const NAV_KEYS = [
			'ArrowDown',
			'ArrowUp',
			'ArrowLeft',
			'ArrowRight',
			'Home',
			'End',
			'Enter',
			' '
		];
		if (!NAV_KEYS.includes(e.key)) return;
		scrollRoot?.focus({ preventScroll: true });

		const i = currentFocusIndex();
		const node = nodes[i];

		// Option/Alt + Up/Down jumps to the next/previous file, skipping folders.
		if (e.altKey) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				focusFileFrom(i, 1);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				focusFileFrom(i, -1);
			}
			return;
		}

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				focusNode(Math.min(nodes.length - 1, i + 1));
				break;
			case 'ArrowUp':
				e.preventDefault();
				focusNode(Math.max(0, i - 1));
				break;
			case 'Home':
				e.preventDefault();
				focusNode(0);
				break;
			case 'End':
				e.preventDefault();
				focusNode(nodes.length - 1);
				break;
			case 'ArrowRight':
				e.preventDefault();
				if (node?.kind === 'folder') {
					if (app.collapsedFolders.has(node.path)) {
						actions.toggleFolder(node.path); // expand in place
					} else if (i + 1 < nodes.length) {
						focusNode(i + 1); // step into first child
					}
				}
				break;
			case 'ArrowLeft':
				e.preventDefault();
				if (node?.kind === 'folder' && !app.collapsedFolders.has(node.path)) {
					actions.toggleFolder(node.path); // collapse in place
				} else if (node) {
					// Jump to the parent folder row, if one is visible.
					const slash = node.path.lastIndexOf('/');
					const parent = slash >= 0 ? node.path.slice(0, slash) : '';
					if (parent) {
						const p = nodes.findIndex((n) => n.kind === 'folder' && n.path === parent);
						if (p !== -1) focusNode(p);
					}
				}
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				if (node?.kind === 'folder') {
					actions.toggleFolder(node.path);
				} else if (node?.kind === 'file') {
					pick(node.path);
				}
				break;
		}
	}

	function toggleSeen(e: MouseEvent, f: ChangedFile): void {
		e.stopPropagation();
		void actions.toggleSeen(f.path);
	}

	function toggleInclude(e: MouseEvent, f: ChangedFile): void {
		e.stopPropagation();
		// Master toggle: a fully-included file unchecks; an unchecked OR partially-
		// staged file checks every line (clearing any partial selection).
		const include = actions.fileStagingState(f.path) !== 'all';
		actions.toggleFileIncludedForCommit(f.path, include);
	}

	// Folder checkbox: if every descendant is already included, unchecking it
	// excludes them all; otherwise (none or some) checking it includes them all.
	function toggleFolderInclude(e: MouseEvent, filePaths: string[], allIncluded: boolean): void {
		e.stopPropagation();
		actions.setFilesIncludedForCommit(filePaths, !allIncluded);
	}

	function setTab(v: string): void {
		void actions.setContextTab(v as ContextTab);
	}

	// The session whose diff is currently open (Sessions tab). When set, the
	// header swaps its tab strip for a back button + session name.
	const activeSession = $derived(
		app.activeSessionId ? app.sessions.find((s) => s.id === app.activeSessionId) : undefined
	);

	// Virtualizer state — wired up to the Sidebar.Content scroll container
	// through its `ref` prop. We re-measure on scroll (for scrollTop) and on
	// resize (for clientHeight — pane drags, window resize, sidebar collapse).
	let scrollRoot = $state<HTMLElement | null>(null);
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	// Container width and the CSS font shorthand used by file rows — both feed
	// the pretext-based path truncation in list layout. Tracking width here
	// (rather than per-row) lets us re-use one cache entry per (width, path)
	// across the whole virtualized list.
	let scrollRootWidth = $state(0);
	let rowFont = $state<string>('12px ui-sans-serif, system-ui, sans-serif');

	$effect(() => {
		if (!scrollRoot) return;
		const el = scrollRoot;
		scrollTop = el.scrollTop;
		viewportHeight = el.clientHeight;
		scrollRootWidth = el.clientWidth;
		const cs = window.getComputedStyle(el);
		// text-xs = 12px / 16px in Tailwind. Construct a canvas-compatible font
		// shorthand using the container's inherited font-family.
		rowFont = `${cs.fontWeight} 12px ${cs.fontFamily}`;
		// Make the list a focusable tree region so arrow keys only navigate when
		// the list has focus — elsewhere (e.g. the diff pane) arrows still scroll.
		// Suppress the browser's default focus outline on the container itself; the
		// cursor row carries its own subtle highlight instead.
		el.tabIndex = 0;
		el.setAttribute('role', 'tree');
		el.style.outline = 'none';
		const onScroll = (): void => {
			scrollTop = el.scrollTop;
		};
		el.addEventListener('scroll', onScroll, { passive: true });
		el.addEventListener('keydown', onTreeKeydown);
		const ro = new ResizeObserver(() => {
			viewportHeight = el.clientHeight;
			scrollRootWidth = el.clientWidth;
		});
		ro.observe(el);
		return () => {
			el.removeEventListener('scroll', onScroll);
			el.removeEventListener('keydown', onTreeKeydown);
			ro.disconnect();
		};
	});

	// Approximate width available for the path text in a list-layout row, after
	// subtracting fixed UI chrome (checkbox, optional file icon, gaps, padding,
	// and a generous reserve for the +/- stats span). One shared value across
	// all rows — slight per-row stats variance is absorbed by the reserve.
	const availablePathWidth = $derived.by(() => {
		const checkbox = 14;
		const icon = app.showFileIcons ? 14 + 6 : 0;
		const statsReserve = 70;
		const gapsAndPadding = 6 + 6 + 8 + 8;
		return Math.max(0, scrollRootWidth - checkbox - icon - statsReserve - gapsAndPadding);
	});

	// Render only the slice of nodes that intersects the viewport (plus a
	// small buffer). Until we've measured the viewport, render a reasonable
	// default window so the first paint isn't empty.
	const visibleRange = $derived.by(() => {
		if (nodes.length === 0) return { start: 0, end: 0 };
		if (viewportHeight === 0) {
			return { start: 0, end: Math.min(nodes.length, 60) };
		}
		const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
		const end = Math.min(
			nodes.length,
			Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER_ROWS
		);
		return { start, end };
	});
	const visibleNodes = $derived(nodes.slice(visibleRange.start, visibleRange.end));
	const topSpacer = $derived(visibleRange.start * ROW_HEIGHT);
	const bottomSpacer = $derived((nodes.length - visibleRange.end) * ROW_HEIGHT);

	// Keep the cursor synced to the open file whenever it changes from outside
	// the tree (clicking a row, "next file" in the diff, etc.) so keyboard
	// navigation resumes from wherever the user last landed.
	$effect(() => {
		const sel = app.selectedFile;
		if (sel) focusedPath = sel;
	});

	// Keep the keyboard cursor visible as it (or the open file) moves. Because
	// the list is virtualized, `scrollIntoView` on the row element won't work
	// (rows outside the visible window aren't mounted) — we set `scrollTop`
	// directly using the known row index × ROW_HEIGHT layout. Reading
	// `scrollRoot.scrollTop` / `.clientHeight` directly (not the reactive
	// mirrors) keeps this effect from re-firing on every scroll tick.
	$effect(() => {
		const path = focusedPath;
		if (!path || !scrollRoot) return;
		const idx = nodes.findIndex((n) => n.path === path);
		if (idx === -1) return;
		const el = scrollRoot;
		const itemTop = idx * ROW_HEIGHT;
		const itemBottom = itemTop + ROW_HEIGHT;
		const viewTop = el.scrollTop;
		const viewBottom = viewTop + el.clientHeight;
		if (itemTop < viewTop) {
			el.scrollTop = itemTop;
		} else if (itemBottom > viewBottom) {
			el.scrollTop = itemBottom - el.clientHeight;
		}
	});

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const toggleShortcut = isMac ? '⌘B' : 'Ctrl+B';

	// Sidebar context from the app-level Sidebar.Provider. Its toggle() drives the
	// resizable pane (via onOpenChange → pane.expand/collapse), which is the real
	// source of truth — flipping app.sidebarCollapsed alone wouldn't move the pane.
	const sidebar = Sidebar.useSidebar();

	// The configurable "search files (sidebar)" shortcut jumps focus to the
	// search input from anywhere in the app. When the binding has no modifier
	// (the default is `/`), it's skipped while the user is typing in an editable
	// target so it doesn't hijack the commit composer, comment composer, or the
	// search input itself. A modifier combo is deliberate and fires anywhere.
	let searchInput = $state<HTMLInputElement | null>(null);
	$effect(() => {
		function onKeydown(e: KeyboardEvent): void {
			const hk = app.hotkeys.searchFilesSidebar;
			if (!matchesHotkey(e, hk)) return;
			if (!hk.mod && !hk.alt) {
				const target = e.target as HTMLElement | null;
				if (
					target &&
					(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
				) {
					return;
				}
			}
			if (!searchInput) return;
			e.preventDefault();
			searchInput.focus();
			searchInput.select();
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

<!--
  Width is controlled by the surrounding Resizable.Pane. collapsible="none"
  keeps Sidebar.Root from imposing its own fixed-position layout. The pane
  collapses to 0 width on Cmd+B or drag, which unmounts this visually — so
  we no longer need an in-list "expand from collapsed" branch.
-->
<Sidebar.Root collapsible="none" class="h-full w-full border-r border-sidebar-border bg-card/30">
	<Sidebar.Header class="gap-0 p-0">
		<!-- Combined header — context tabs on the left, then seen/total + adds/dels
         totals, and the collapse trigger pinned right. Matches the diff sticky
         header height so their bottom borders line up across panes. -->
		<div class="flex h-11 items-center gap-2 border-b border-border pr-2 pl-1">
			{#if app.activeSessionId}
				<!-- A session's diff is open: the tab strip is replaced with a back
             button and a muted "Sessions" label naming where it returns to.
             The session's own logo/name/description live in the row below. -->
				<Button
					variant="ghost"
					size="icon"
					class="size-7 flex-none"
					title="Back to sessions"
					onclick={() => actions.closeSession()}
				>
					<ArrowLeft class="size-4" />
				</Button>
				<span class="min-w-0 flex-1 truncate text-sm text-muted-foreground"> Sessions </span>
			{:else}
				<!-- Tab strip: drives which diff context fuels the file list. -->
				<Tabs.Root value={app.contextTab} onValueChange={setTab} class="min-w-0 flex-1 gap-0">
					<Tabs.List
						class="no-scrollbar w-full justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0"
					>
						<Tabs.Trigger
							value="unstaged"
							class="h-7 flex-none gap-1.5 rounded-md border-0 px-3 py-1.5 text-xs shadow-none data-active:bg-muted data-active:text-foreground data-active:shadow-none dark:data-active:border-0 dark:data-active:bg-muted"
						>
							Unstaged
							{#if app.unstagedFileCount > 0}
								<span
									class="grid h-4 min-w-4 place-items-center rounded-full bg-foreground/10 px-1 text-[10px] leading-none font-medium text-foreground tabular-nums"
								>
									{app.unstagedFileCount > 99 ? '99+' : app.unstagedFileCount}
								</span>
							{/if}
						</Tabs.Trigger>
						<Tabs.Trigger
							value="branch"
							class="h-7 flex-none rounded-md border-0 px-3 py-1.5 text-xs shadow-none data-active:bg-muted data-active:text-foreground data-active:shadow-none dark:data-active:border-0 dark:data-active:bg-muted"
						>
							Branch
						</Tabs.Trigger>
						<Tabs.Trigger
							value="sessions"
							class="h-7 flex-none rounded-md border-0 px-3 py-1.5 text-xs shadow-none data-active:bg-muted data-active:text-foreground data-active:shadow-none dark:data-active:border-0 dark:data-active:bg-muted"
						>
							Sessions
						</Tabs.Trigger>
					</Tabs.List>
				</Tabs.Root>
			{/if}

			{#if app.changedFiles.length > 0 && app.contextTab !== 'unstaged'}
				<span class="text-xs text-muted-foreground tabular-nums">
					<span class="font-medium">{seenDisplay}/{app.changedFiles.length}</span>
				</span>
			{/if}
			{#if app.changedFiles.length > 0}
				<span class="text-[11px] tabular-nums">
					<span class="text-success">+{addDisplay}</span>
					<span class="ml-0.5 text-destructive">−{delDisplay}</span>
				</span>
			{/if}
			<Button
				variant="ghost"
				size="icon"
				title={`Collapse sidebar (${toggleShortcut})`}
				onclick={() => sidebar.toggle()}
			>
				<PanelLeft class="size-3.5" />
			</Button>
		</div>

		{#if app.activeSessionId}
			<!-- The open session's identity, on its own row so the top header isn't
           cramming the title in beside the back button and totals. -->
			<div class="flex items-start gap-2.5 border-b border-border px-2 py-2">
				<div
					class="mt-0.5 grid size-7 flex-none place-items-center rounded-md border border-border bg-card"
					title={harnessLabel(activeSession?.harness ?? 'other', activeSession?.harnessLabel)}
				>
					<HarnessLogo harness={activeSession?.harness ?? 'other'} size={16} />
				</div>
				<div class="min-w-0 flex-1">
					<div class="truncate text-sm font-medium">
						{activeSession?.name ?? 'Session'}
					</div>
					{#if activeSession?.description}
						<p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
							{activeSession.description}
						</p>
					{/if}
				</div>
			</div>
		{/if}

		{#if app.activeSessionId && sessionHasSteps}
			<!-- Toggle between the narrated tour and the plain file-by-file review. -->
			<div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
				<button
					type="button"
					class={cn(
						'h-7 rounded-md px-3 text-xs font-medium',
						app.sessionView === 'tour'
							? 'bg-muted text-foreground'
							: 'text-muted-foreground hover:text-foreground'
					)}
					onclick={() => actions.setSessionView('tour')}
				>
					Tour
				</button>
				<button
					type="button"
					class={cn(
						'h-7 rounded-md px-3 text-xs font-medium',
						app.sessionView === 'changes'
							? 'bg-muted text-foreground'
							: 'text-muted-foreground hover:text-foreground'
					)}
					onclick={() => actions.setSessionView('changes')}
				>
					Changes
				</button>
			</div>
		{/if}

		{#if showFileControls}
			<div class="flex items-center gap-1.5 border-b border-border py-1.5 pr-2 pl-1">
				<div
					class="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-input bg-background px-2"
				>
					<Search class="size-3 shrink-0 text-muted-foreground" />
					<input
						bind:this={searchInput}
						type="text"
						bind:value={app.fileSearchQuery}
						placeholder="Search files or *.svelte…"
						class="h-full w-full min-w-0 bg-transparent text-xs outline-hidden placeholder:text-muted-foreground"
					/>
					{#if app.fileSearchQuery}
						<button
							type="button"
							class="shrink-0 text-muted-foreground hover:text-foreground"
							onclick={() => (app.fileSearchQuery = '')}
							aria-label="Clear search"
						>
							<X class="size-3" />
						</button>
					{:else}
						<Kbd title="Press / to search">/</Kbd>
					{/if}
				</div>
				<!-- Single button that swaps the active tab's file list between tree
             and list layout, showing the current layout's icon. -->
				<Button
					variant="outline"
					size="icon-sm"
					class="shrink-0 text-muted-foreground"
					title={isTreeLayout ? 'Switch to list view' : 'Switch to tree view'}
					aria-label={isTreeLayout ? 'Switch to list view' : 'Switch to tree view'}
					onclick={() => void actions.setFileListLayout(isTreeLayout ? 'list' : 'tree')}
				>
					{#if isTreeLayout}
						<FolderTree class="size-3.5" />
					{:else}
						<List class="size-3.5" />
					{/if}
				</Button>
			</div>
		{/if}

		{#if app.contextTab === 'unstaged' && app.changedFiles.length > 0}
			<!-- GitHub-Desktop-style master checkbox: check/uncheck every changed
           file at once. Custom button (not the Checkbox component) so its box,
           border and check glyph match the per-row checkboxes exactly. Shows a
           dash when only some files are checked. -->
			<button
				type="button"
				role="checkbox"
				aria-checked={allIncluded ? true : someIncluded ? 'mixed' : false}
				aria-label="Select all changed files"
				onclick={() => actions.setAllIncludedForCommit(!allIncluded)}
				class="flex h-8 w-full cursor-pointer items-center gap-1.5 border-b border-border px-2 text-left text-xs text-muted-foreground outline-hidden select-none hover:text-foreground"
			>
				<span
					class={cn(
						'grid size-3.5 shrink-0 place-items-center rounded-[4px] border',
						allIncluded || someIncluded
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-input'
					)}
				>
					{#if allIncluded}
						<Check class="size-2.5" />
					{:else if someIncluded}
						<Minus class="size-2.5" />
					{/if}
				</span>
				<span class="tabular-nums">
					{includedCount} of {app.changedFiles.length} changed file{app.changedFiles.length === 1
						? ''
						: 's'}
				</span>
			</button>
		{/if}
	</Sidebar.Header>

	<Sidebar.Content bind:ref={scrollRoot}>
		{#if app.contextTab === 'sessions' && !app.activeSessionId}
			<!-- Sessions tab with no session open: list the documented sessions. -->
			<SessionsList />
		{:else if showSessionTour}
			<!-- An open session's Tour view: grouped step-by-step navigation. The
             Changes view (and stepless sessions) fall through to the file list. -->
			<SessionTour />
		{:else if app.loading.files && app.changedFiles.length === 0}
			<div class="px-3 py-6 text-center text-xs text-muted-foreground">Loading…</div>
		{:else if app.changedFiles.length === 0}
			<div class="px-3 py-8 text-center text-xs text-muted-foreground">
				{#if app.contextTab === 'branch'}
					No changes on this branch
				{:else}
					No changes
				{/if}
			</div>
		{:else if filteredFiles.length === 0}
			<div class="px-3 py-8 text-center text-xs text-muted-foreground">
				No files match "{app.fileSearchQuery}"
			</div>
		{:else}
			<!--
          Virtualized window: only the slice intersecting the viewport (plus
          BUFFER_ROWS on either side) is mounted. The padding spacers reserve
          the scrollable area so the scrollbar reflects total length and
          scrollTop math keeps tracking the true list position.
        -->
			<div style="padding-top: {topSpacer}px; padding-bottom: {bottomSpacer}px;">
				{#each visibleNodes as node (node.kind + ':' + node.path)}
					{#if node.kind === 'folder'}
						{@const open = !app.collapsedFolders.has(node.path)}
						{@const isFocused = focusedPath === node.path}
						{@const isUnstaged = app.contextTab === 'unstaged'}
						<!-- Folder commit checkbox (Unstaged only): tri-state over every
                   descendant file — checked when all are included, a dash when
                   only some are, empty when none. -->
						{@const folderIncluded = node.filePaths.filter(
							(p) => !app.excludedFromCommit.has(p)
						).length}
						{@const folderAll = folderIncluded === node.filePaths.length}
						{@const folderNone = folderIncluded === 0}
						<div
							role="treeitem"
							aria-expanded={open}
							aria-selected={false}
							class={cn(
								'group flex w-full items-center gap-1.5 pr-2 text-xs text-muted-foreground',
								isFocused ? 'bg-accent/60' : 'hover:bg-accent/50'
							)}
							style="height: {ROW_HEIGHT}px; padding-left: {node.depth * 12 + 8}px"
						>
							{#if isUnstaged}
								<button
									class={cn(
										'grid size-3.5 shrink-0 place-items-center rounded-[4px] border outline-hidden',
										folderNone
											? 'border-input hover:border-foreground'
											: 'border-primary bg-primary text-primary-foreground'
									)}
									onclick={(e) => toggleFolderInclude(e, node.filePaths, folderAll)}
									aria-label={folderAll ? 'Exclude folder from commit' : 'Include folder in commit'}
									role="checkbox"
									aria-checked={folderAll ? true : folderNone ? false : 'mixed'}
									type="button"
								>
									{#if folderAll}
										<Check class="size-2.5" />
									{:else if !folderNone}
										<Minus class="size-2.5" />
									{/if}
								</button>
							{/if}
							<button
								type="button"
								class="flex h-full min-w-0 flex-1 items-center gap-1 text-left outline-hidden"
								onclick={() => {
									focusedPath = node.path;
									actions.toggleFolder(node.path);
								}}
							>
								<ChevronRight
									class={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
								/>
								{#if open}
									<FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
								{:else}
									<Folder class="size-3.5 shrink-0 text-muted-foreground" />
								{/if}
								<span class="truncate">{node.name}</span>
							</button>
						</div>
					{:else}
						{@const isSeen = app.seenFiles.has(node.file.path)}
						{@const iconName = languageIconForPath(node.file.path)}
						{@const isActive = app.selectedFile === node.file.path}
						{@const isSelected = app.selectedFiles.has(node.file.path)}
						{@const isFocused = focusedPath === node.file.path}
						{@const threadCount = (app.prComments[node.file.path] ?? []).filter(
							(c) => !c.inReplyTo
						).length}
						<!-- Unstaged rows show a commit-inclusion checkbox instead of the
                   "seen" indicator; the seen flow still drives collapse, but its
                   state isn't surfaced here. `seenVisual` gates the strikethrough
                   so unstaged filenames never read as "seen". -->
						{@const isUnstaged = app.contextTab === 'unstaged'}
						{@const stagingState = actions.fileStagingState(node.file.path)}
						{@const isIncluded = stagingState !== 'none'}
						{@const isPartial = stagingState === 'partial'}
						{@const seenVisual = isSeen && !isUnstaged}
						<div
							role="treeitem"
							aria-selected={isActive}
							tabindex={-1}
							class={cn(
								'group flex w-full items-center gap-1.5 border-l-2 border-transparent pr-2 select-none',
								isActive
									? 'border-l-foreground bg-accent'
									: isSelected
										? 'bg-accent'
										: isFocused
											? 'bg-accent/60'
											: 'hover:bg-accent/50'
							)}
							style="height: {ROW_HEIGHT}px; padding-left: {node.depth * 12 + 6}px"
							oncontextmenu={(e) => onRowContextMenu(e, node.file)}
						>
							{#if isUnstaged}
								<button
									class={cn(
										'grid size-3.5 shrink-0 place-items-center rounded-[4px] border outline-hidden',
										isIncluded
											? 'border-primary bg-primary text-primary-foreground'
											: 'border-input hover:border-foreground'
									)}
									onclick={(e) => toggleInclude(e, node.file)}
									aria-label={isIncluded ? 'Exclude from commit' : 'Include in commit'}
									role="checkbox"
									aria-checked={isPartial ? 'mixed' : isIncluded}
									type="button"
								>
									{#if isPartial}
										<Minus class="size-2.5" />
									{:else if isIncluded}
										<Check class="size-2.5" />
									{/if}
								</button>
							{:else}
								<button
									class={cn(
										'grid size-3.5 shrink-0 place-items-center rounded border outline-hidden',
										isSeen
											? 'text-success-foreground border-success bg-success'
											: 'border-border hover:border-foreground'
									)}
									onclick={(e) => toggleSeen(e, node.file)}
									aria-label={isSeen ? 'Mark unseen' : 'Mark seen'}
									type="button"
								>
									{#if isSeen}
										<Check class="size-2.5" />
									{/if}
								</button>
							{/if}
							<button
								class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-hidden"
								onclick={(e) => onFileClick(e, node.file)}
								type="button"
							>
								{#if app.showFileIcons}
									<Icon icon={iconName} class="size-3.5 shrink-0" />
								{/if}
								{#if node.dirPrefix !== undefined}
									{@const displayPrefix = node.dirPrefix
										? truncatePathPrefix(node.dirPrefix, node.name, availablePathWidth, rowFont)
										: ''}
									<!-- Inline whitespace is intentional: any newline between
                         these flex children becomes a text node inside the
                         flex container, which can render as a visible gap
                         between the truncated prefix and the filename. The
                         prefix string is pre-truncated by pretext to fit
                         `availablePathWidth`, so no CSS text-overflow is
                         needed — that's the whole point of doing this in JS,
                         since text-overflow re-flows every row on every
                         pixel of a sidebar resize. -->
									<span
										class={cn(
											'flex min-w-0 flex-1 items-center overflow-hidden text-xs whitespace-nowrap',
											seenVisual && 'text-muted-foreground line-through'
										)}
										>{#if displayPrefix}<span class="text-muted-foreground">{displayPrefix}</span
											>{/if}<span class="shrink-0">{node.name}</span></span
									>
								{:else}
									<span
										class={cn(
											'truncate text-xs',
											seenVisual && 'text-muted-foreground line-through'
										)}
									>
										{node.name}
									</span>
								{/if}
								<span class="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] tabular-nums">
									{#if threadCount > 0}
										<span
											class="flex items-center gap-0.5 text-muted-foreground"
											title="{threadCount} comment thread{threadCount === 1 ? '' : 's'}"
										>
											<MessageSquare class="size-3" />
											{threadCount}
										</span>
									{/if}
									<span class="flex items-center gap-0.5">
										{#if node.file.status === 'deleted'}
											<FileMinus class="size-3 text-destructive" />
										{:else if node.file.status === 'renamed' || node.file.status === 'copied'}
											<FileEdit class="size-3 text-warning" />
										{:else if node.file.isBinary}
											<span class="text-muted-foreground">bin</span>
										{:else}
											{#if node.file.additions > 0}
												<span class="text-success">+{node.file.additions}</span>
											{/if}
											{#if node.file.deletions > 0}
												<span class="text-destructive">−{node.file.deletions}</span>
											{/if}
										{/if}
									</span>
								</span>
							</button>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</Sidebar.Content>

	{#if app.contextTab === 'unstaged'}
		<Sidebar.Footer class="gap-0 p-0">
			<CommitBox />
		</Sidebar.Footer>
	{/if}
</Sidebar.Root>
