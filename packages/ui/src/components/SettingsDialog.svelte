<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import AppWindow from '@lucide/svelte/icons/app-window';
	import BadgeCheck from '@lucide/svelte/icons/badge-check';
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import Bot from '@lucide/svelte/icons/bot';
	import Check from '@lucide/svelte/icons/check';
	import Code2 from '@lucide/svelte/icons/code-2';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Diff from '@lucide/svelte/icons/diff';
	import Download from '@lucide/svelte/icons/download';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import FileJson from '@lucide/svelte/icons/file-json';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Palette from '@lucide/svelte/icons/palette';
	import Plus from '@lucide/svelte/icons/plus';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Search from '@lucide/svelte/icons/search';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CloudCheck from '@lucide/svelte/icons/cloud-check';
	import Loader from '@lucide/svelte/icons/loader';
	import Upload from '@lucide/svelte/icons/upload';
	import User from '@lucide/svelte/icons/user';
	import X from '@lucide/svelte/icons/x';
	import SettingsShell from './SettingsShell.svelte';
	import * as Avatar from './ui/avatar';
	import * as DropdownMenu from './ui/dropdown-menu';
	import { Button } from './ui/button';
	import { Switch } from './ui/switch';
	import { Input } from './ui/input';
	import { Spinner } from './ui/spinner';
	import CursorIcon from './icons/CursorIcon.svelte';
	import VSCodeIcon from './icons/VSCodeIcon.svelte';
	import XcodeIcon from './icons/XcodeIcon.svelte';
	import ZedIcon from './icons/ZedIcon.svelte';
	import VisualStudioIcon from './icons/VisualStudioIcon.svelte';
	import GhostIcon from './icons/GhostIcon.svelte';
	import WarpIcon from './icons/WarpIcon.svelte';
	import ITermIcon from './icons/ITermIcon.svelte';
	import TerminalAppIcon from './icons/TerminalAppIcon.svelte';
	import PowerShellIcon from './icons/PowerShellIcon.svelte';
	import ZshIcon from './icons/ZshIcon.svelte';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import LicenseCard from './LicenseCard.svelte';
	import DiffStylePreview from './DiffStylePreview.svelte';
	import DiffFileHeader from './DiffFileHeader.svelte';
	import SettingSelect from './SettingSelect.svelte';
	import AppChromePreview from './AppChromePreview.svelte';
	import UsageStatsPanel from './UsageStatsPanel.svelte';
	import AgentsSettingsPanel from './AgentsSettingsPanel.svelte';
	import {
		actions,
		app,
		codeFontCss,
		codeFontFeatures,
		effectiveEditor,
		effectiveTerminal,
		UI_FONTS,
		CODE_FONTS,
		type SettingsTab
	} from '@super-review/ui/store.svelte';
	import HotkeyInput from './HotkeyInput.svelte';
	import { DEFAULT_HIDDEN_DIFF_PATTERNS } from '@super-review/core/diff-defer';
	import {
		DEFAULT_HOTKEYS,
		HOTKEY_ACTIONS,
		HOTKEY_LABELS,
		formatHotkeyParts,
		hotkeysEqual,
		reservedHotkeyLabel,
		type Hotkey,
		type HotkeyAction,
		type Hotkeys
	} from '@super-review/core/hotkeys';
	import {
		EDITORS_BY_PLATFORM,
		TERMINALS_BY_PLATFORM,
		WINDOW_BOUNDS
	} from '@super-review/core/types';
	import { cn } from '@super-review/ui/utils';
	import { ACCENTS } from '@super-review/ui/accents';
	import { DIFF_THEMES, diffThemePair } from '@super-review/ui/diff-themes';
	import { resolveIconSrc } from '@super-review/ui/file-icons';
	import type {
		Accent,
		AnimationMode,
		CustomFileIcon,
		DiffLayout,
		EditorKind,
		PrMergedBehavior,
		TerminalKind,
		ViewMode
	} from '@super-review/core/types';

	let activeTab = $state<SettingsTab>('accounts');

	// Which tabs have had their heavy content mounted. A tab's expensive parts (the
	// live previews, the Agents and Stats panels) mount the first time the user
	// opens that tab and then STAY mounted for the life of the dialog. Gating them
	// on `activeTab` instead meant every visit tore the content down and rebuilt it
	// from scratch — re-running the Pierre + highlighter render for the diff
	// preview, reconstructing the stats chart, and re-firing the panels' onMount
	// IPC (the Agents panel rescans the filesystem) on every single click. Keeping
	// them alive makes the first visit cost what it costs and every return free.
	// Reset when the dialog opens so a fresh session starts lean again.
	const mountedTabs = new SvelteSet<SettingsTab>();
	// Reading `has` keeps this subscribed to the set itself, so the `clear()` on
	// open re-runs it and the tab being shown is mounted again right away.
	$effect(() => {
		if (!mountedTabs.has(activeTab)) mountedTabs.add(activeTab);
	});

	const TABS: { id: SettingsTab; label: string; icon: typeof User }[] = [
		{ id: 'accounts', label: 'Accounts', icon: User },
		{ id: 'license', label: 'License', icon: BadgeCheck },
		{ id: 'appearance', label: 'Appearance', icon: Palette },
		{ id: 'diff', label: 'Diff', icon: Diff },
		{ id: 'behavior', label: 'Behavior', icon: SlidersHorizontal },
		{ id: 'app', label: 'App', icon: AppWindow },
		{ id: 'editor', label: 'Integrations', icon: Code2 },
		{ id: 'agents', label: 'Agents', icon: Bot },
		{ id: 'hotkeys', label: 'Hotkeys', icon: Keyboard },
		{ id: 'stats', label: 'Stats', icon: BarChart3 },
		{ id: 'updates', label: 'Updates', icon: RefreshCw }
	];

	// An update that exists but isn't installed yet, in any of its stages. Drives
	// the dot on the Updates tab so the dialog advertises it without the user
	// having to go looking.
	const updatePending = $derived(
		app.update.state === 'available' ||
			app.update.state === 'downloading' ||
			app.update.state === 'downloaded'
	);

	// TABS is the structural list (it also drives the content loop); the nav needs
	// the live indicator layered on, so derive it rather than mutating TABS.
	const navTabs = $derived(
		TABS.map((t) => (t.id === 'updates' ? { ...t, indicator: updatePending } : t))
	);

	// One declarative list is the structural source of truth for every settings
	// section: it drives the rendered tab content (the loops in the content snippet)
	// AND the search jump-list (matched against title/description/keywords). `id` is
	// the section element's id, used for scroll-to (goToSetting) and to dispatch the
	// section's body markup (see the sectionBody snippet). `kind: 'row'` is a simple
	// setting rendered as a uniform card row (title + blurb on the left, one basic
	// control — switch / select / input — on the right, dispatched by
	// `compactControl`); everything else is a `block` with bespoke markup in
	// `sectionBody` (tables, lists, panels). `title` is the visible heading; sections
	// that render their own heading or none set `label` instead. `description` is the
	// row's blurb. `keywords` are extra search-only synonyms not in the visible text.
	// `hasReset` opts a section into the header "Reset" action.
	type SettingsSection = {
		tab: SettingsTab;
		id: string;
		kind?: 'row' | 'block';
		// Consecutive `row` sections form one card; a differing `group` starts a new
		// card, so related rows (e.g. merged-branch handling) read as their own unit.
		group?: string;
		title?: string;
		label?: string;
		description?: string;
		keywords: string;
		hasReset?: boolean;
	};

	const SECTIONS: SettingsSection[] = [
		{
			tab: 'license',
			id: 'settings-super-review',
			title: 'Super Review',
			keywords:
				'super review license licensed holder subscription subscribe plan perpetual lifetime annual yearly monthly trial upgrade manage billing payment invoice renew renewal cancel purchase buy pay expires expiry active since account signed in sign out signout log out logout activate activation authorize device card'
		},
		{
			tab: 'accounts',
			id: 'settings-accounts-github',
			title: 'GitHub.com',
			keywords: 'account sign in login github default avatar pull request token'
		},
		// Appearance — app chrome, sharing one chrome preview at the bottom.
		{
			tab: 'appearance',
			id: 'settings-theme',
			kind: 'row',
			title: 'Theme',
			description: 'Light or dark appearance.',
			keywords: 'light dark mode color appearance'
		},
		{
			tab: 'appearance',
			id: 'settings-accent',
			kind: 'row',
			title: 'Accent',
			description: 'Color for buttons, links, and focus rings.',
			keywords: 'color accent highlight link button focus ring'
		},
		{
			tab: 'appearance',
			id: 'settings-ui-font',
			kind: 'row',
			title: 'UI font',
			description: 'Font for the sidebar and app chrome.',
			keywords: 'font typeface ui sidebar chrome text'
		},
		{
			tab: 'appearance',
			id: 'settings-file-icons',
			kind: 'row',
			title: 'File icons',
			description: 'Language icons next to file names.',
			keywords: 'file icons language sidebar'
		},
		{
			tab: 'appearance',
			id: 'settings-animations',
			kind: 'row',
			title: 'Animations',
			description: 'How much motion the UI uses.',
			keywords: 'animation motion transitions reduce'
		},
		// Diff — how diffs and code render, sharing one live diff preview.
		{
			tab: 'diff',
			id: 'settings-diff-view',
			kind: 'row',
			title: 'Diff view',
			description: 'How changes are displayed.',
			keywords: 'diff split unified view changes'
		},
		{
			tab: 'diff',
			id: 'settings-diff-layout',
			kind: 'row',
			title: 'Diff layout',
			description: 'One scroll, or one file at a time.',
			keywords: 'diff layout scroll single file list github desktop'
		},
		{
			tab: 'diff',
			id: 'settings-diff-theme',
			kind: 'row',
			title: 'Diff theme',
			description: 'Syntax theme for diff code blocks.',
			keywords: 'diff theme syntax highlighting colors'
		},
		{
			tab: 'diff',
			id: 'settings-code-font',
			kind: 'row',
			title: 'Code font',
			description: 'Font for diffs and code.',
			keywords: 'font typeface code monospace diff'
		},
		{
			tab: 'diff',
			id: 'settings-indent-guides',
			kind: 'row',
			title: 'Indent guides',
			description: 'Vertical lines marking indentation levels.',
			keywords: 'indent indentation guides lines scope nesting whitespace'
		},
		{
			tab: 'behavior',
			id: 'settings-arrow-nav',
			kind: 'row',
			title: 'Arrow-key navigation',
			description: 'Whether arrowing onto a file in the sidebar opens its diff.',
			keywords: 'arrow key navigation keyboard file open sidebar enter list'
		},
		{
			tab: 'behavior',
			id: 'settings-reviewing',
			kind: 'row',
			title: 'Unmark seen files when they change',
			description: 'Clear a file’s seen mark when it changes.',
			keywords: 'review seen unseen mark files change'
		},
		{
			tab: 'behavior',
			id: 'settings-commits',
			kind: 'row',
			title: 'Sign my commits',
			description: 'Sign commits so they show as Verified.',
			keywords: 'commit sign signing ssh key verified'
		},
		{
			tab: 'behavior',
			id: 'settings-recent-repos',
			kind: 'row',
			title: 'Recent repositories',
			description: 'How many repositories the picker lists under Recent.',
			keywords: 'recent repositories repos picker count history'
		},
		{
			tab: 'behavior',
			id: 'settings-large-diffs',
			kind: 'row',
			title: 'Large diffs',
			description: 'Diffs with more changed lines than this are hidden behind a Load diff button.',
			keywords: 'large diff lines load limit performance loc'
		},
		// Merged-branch handling — its own card via the shared `group`.
		{
			tab: 'behavior',
			id: 'settings-merged-branches',
			kind: 'row',
			group: 'merged',
			title: 'When a PR is merged',
			description: 'When a PR merges, switch back to the branch it merged into?',
			keywords: 'merged branch pull request switch remove delete prompt base target into'
		},
		{
			tab: 'behavior',
			id: 'settings-auto-remove-merged',
			kind: 'row',
			group: 'merged',
			title: 'Auto-remove merged branches',
			description: 'Delete merged branches locally after switching away.',
			keywords: 'merged branch remove delete local automatically'
		},
		{
			tab: 'behavior',
			id: 'settings-hidden-files',
			title: 'Hidden files',
			keywords: 'hidden files glob pattern lock build ignore',
			hasReset: true
		},
		{
			tab: 'behavior',
			id: 'settings-custom-file-icons',
			title: 'Custom file icons',
			keywords: 'custom file icon glob pattern image'
		},
		{
			tab: 'app',
			id: 'settings-window-size',
			kind: 'row',
			title: 'Window size',
			description: 'The size the window opens at. Applies next launch.',
			keywords: 'window size width height pixels maximize'
		},
		{
			tab: 'app',
			id: 'settings-start-maximized',
			kind: 'row',
			title: 'Start maximized',
			description: 'Open maximized to fill the screen.',
			keywords: 'window maximize fullscreen start launch'
		},
		{
			tab: 'editor',
			id: 'settings-external-editor',
			title: 'External editor',
			keywords: 'editor external vscode cursor zed xcode visual studio'
		},
		{
			tab: 'editor',
			id: 'settings-terminal',
			title: 'Terminal',
			keywords: 'terminal iterm warp ghostty powershell command prompt'
		},
		{
			tab: 'editor',
			id: 'settings-changesets',
			kind: 'row',
			title: 'Changesets',
			description: 'Commit autofill for repos using Changesets.',
			keywords: 'changesets integration changelog version additional'
		},
		{
			tab: 'agents',
			id: 'settings-agents',
			label: 'Agents',
			keywords: 'agents ai skill subagent claude configuration install harness convention'
		},
		{
			tab: 'hotkeys',
			id: 'settings-hotkeys',
			title: 'Keyboard shortcuts',
			keywords:
				'hotkey keyboard shortcut binding keys ' +
				HOTKEY_ACTIONS.map((a) => HOTKEY_LABELS[a].label).join(' '),
			hasReset: true
		},
		{
			tab: 'stats',
			id: 'settings-stats',
			label: 'Usage statistics',
			keywords: 'stats statistics usage activity metrics'
		},
		{
			tab: 'updates',
			id: 'settings-updates',
			title: 'Updates',
			keywords:
				'update updates upgrade version release new latest check download install restart relaunch changelog auto automatic updates installed'
		}
	];

	function sectionsForTab(tab: SettingsTab): SettingsSection[] {
		return SECTIONS.filter((s) => s.tab === tab);
	}

	// Lay a tab out in declared order, grouping each run of consecutive `row`
	// sections into one card and leaving `block` sections standalone. This keeps the
	// uniform card-of-rows look while still allowing a tab to mix in a richer block
	// (a table, a list) between cards.
	type TabSegment =
		| { type: 'card'; group?: string; sections: SettingsSection[] }
		| { type: 'block'; section: SettingsSection };
	function segmentsForTab(tab: SettingsTab): TabSegment[] {
		const segments: TabSegment[] = [];
		for (const s of sectionsForTab(tab)) {
			if (s.kind === 'row') {
				const last = segments[segments.length - 1];
				// Extend the current card only when this row shares its group, so a
				// differing `group` splits the run into a separate card.
				if (last?.type === 'card' && last.group === s.group) last.sections.push(s);
				else segments.push({ type: 'card', group: s.group, sections: [s] });
			} else {
				segments.push({ type: 'block', section: s });
			}
		}
		return segments;
	}

	// The Appearance and Diff tabs render their controls then one shared live
	// preview at the bottom; this maps a tab to which preview it shows.
	const TAB_PREVIEW: Partial<Record<SettingsTab, 'chrome' | 'diff'>> = {
		appearance: 'chrome',
		diff: 'diff'
	};

	// ── Search (Cursor-style jump list) ──
	// Typing filters the sections to a flat list of matches shown in the sidebar;
	// picking one jumps to its tab, scrolls it into view, and flashes it. No
	// in-content highlighting, no match stepping.
	const TAB_BY_ID = new Map(TABS.map((t) => [t.id, t]));

	let searchQuery = $state('');
	const trimmedQuery = $derived(searchQuery.trim());
	const searching = $derived(trimmedQuery.length > 0);
	// The result the arrow keys / Enter act on. Reset to the top whenever the query
	// changes so it always starts on the first (best) match.
	let highlightedIndex = $state(0);
	$effect(() => {
		void trimmedQuery;
		highlightedIndex = 0;
	});

	type SearchHit = { section: SettingsSection; tabLabel: string };
	const searchResults = $derived.by<SearchHit[]>(() => {
		if (!searching) return [];
		const terms = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
		const hits: SearchHit[] = [];
		for (const s of SECTIONS) {
			const tabLabel = TAB_BY_ID.get(s.tab)?.label ?? '';
			const name = s.title ?? s.label ?? '';
			const haystack = `${name} ${s.description ?? ''} ${s.keywords} ${tabLabel}`.toLowerCase();
			if (terms.every((t) => haystack.includes(t))) hits.push({ section: s, tabLabel });
		}
		return hits;
	});

	// Jump to a setting from a search result: clear the query, switch to its tab,
	// then scroll it into view and flash its background so the eye lands on it.
	function goToSetting(section: SettingsSection): void {
		searchQuery = '';
		activeTab = section.tab;
		void tick().then(async () => {
			await tick();
			const el = document.getElementById(section.id);
			if (!el) return;
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			flashElement(el);
		});
	}

	// One-shot orange background flash via the Web Animations API. Unlike a CSS
	// class, a WAAPI animation runs on the document timeline — so it finishes on
	// schedule even if the tab is hidden mid-flash, never replays when the section is
	// re-shown, and (fill: none) leaves no lingering background once it ends. Linear
	// easing fades evenly across the whole duration instead of front-loading it.
	function flashElement(el: HTMLElement): void {
		// Cancel any in-flight flash so re-picking the same row restarts cleanly.
		for (const a of el.getAnimations?.() ?? []) {
			if (a.id === 'settings-flash') a.cancel();
		}
		const anim = el.animate(
			[
				{ backgroundColor: 'rgba(249, 115, 22, 0.3)' },
				{ backgroundColor: 'rgba(249, 115, 22, 0)' }
			],
			{ duration: 3000, easing: 'linear' }
		);
		anim.id = 'settings-flash';
	}

	// Drive the results list from the search box: arrows move the highlight, Enter
	// opens the highlighted result, Escape clears the query (instead of closing the
	// dialog). The highlighted item scrolls into view so it stays visible.
	function handleSearchKey(e: KeyboardEvent): void {
		const n = searchResults.length;
		if (searching && n > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			highlightedIndex =
				e.key === 'ArrowDown' ? (highlightedIndex + 1) % n : (highlightedIndex - 1 + n) % n;
			void tick().then(() => {
				document
					.querySelector(`[data-search-result="${highlightedIndex}"]`)
					?.scrollIntoView({ block: 'nearest' });
			});
			return;
		}
		if (searching && e.key === 'Enter') {
			e.preventDefault();
			const hit = searchResults[highlightedIndex];
			if (hit) goToSetting(hit.section);
			return;
		}
		if (e.key === 'Escape' && searchQuery) {
			e.preventDefault();
			e.stopPropagation();
			searchQuery = '';
		}
	}

	const EDITOR_LABELS: Record<EditorKind, string> = {
		cursor: 'Cursor',
		vscode: 'Visual Studio Code',
		zed: 'Zed',
		xcode: 'Xcode',
		visualstudio: 'Visual Studio'
	};

	const TERMINAL_LABELS: Record<TerminalKind, string> = {
		terminal: 'Terminal',
		iterm: 'iTerm',
		warp: 'Warp',
		ghostty: 'Ghostty',
		cmd: 'Command Prompt',
		powershell: 'PowerShell'
	};

	// Only the editors/terminals that make sense on the current OS, with
	// installed options first and not-installed sunk to the bottom (stable).
	const sortedEditors = $derived(
		[...(EDITORS_BY_PLATFORM[app.platform] ?? [])].sort(
			(a, b) => Number(app.editors[b]) - Number(app.editors[a])
		)
	);
	const sortedTerminals = $derived(
		[...(TERMINALS_BY_PLATFORM[app.platform] ?? [])].sort(
			(a, b) => Number(app.terminals[b]) - Number(app.terminals[a])
		)
	);

	let dialogOpen = $derived(app.settingsDialogOpen);

	// Absolute path to the settings.json dotfile, shown in the Settings file
	// section. Fetched lazily the first time the dialog opens.
	let settingsPath = $state('');
	$effect(() => {
		if (dialogOpen && !settingsPath) {
			void window.api.settings.getPath().then((p) => (settingsPath = p));
		}
	});

	// The editor the "Open in editor" button uses (the configured external editor
	// if set, else the default), so its label/icon match what will open.
	const settingsFileEditor = $derived(effectiveEditor());

	// Draft state — snapshot when the dialog opens, applied on Save.
	let draftViewMode = $state<ViewMode>('split');
	let draftDiffLayout = $state<DiffLayout>('scroll');
	let draftShowFileIcons = $state<boolean>(true);
	let draftAnimations = $state<AnimationMode>('accents');
	let draftOpenFileOnArrowNav = $state<boolean>(true);
	let draftPrMergedBehavior = $state<PrMergedBehavior>('prompt');
	let draftAutoRemoveMergedBranch = $state<boolean>(false);
	let draftUnmarkSeenOnChange = $state<boolean>(true);
	let draftSignCommits = $state<boolean>(true);
	let draftMaxDiffLines = $state<number>(1500);
	let draftRecentRepoCount = $state<number>(5);
	let draftWindowWidth = $state<number>(WINDOW_BOUNDS.defaultWidth);
	let draftWindowHeight = $state<number>(WINDOW_BOUNDS.defaultHeight);
	let draftStartMaximized = $state<boolean>(false);
	let draftHiddenDiffPatterns = $state<string[]>([]);
	let newPattern = $state<string>('');
	let draftCustomFileIcons = $state<CustomFileIcon[]>([]);
	let newIconPattern = $state<string>('');
	let newIconSource = $state<string>('');
	let draftTheme = $state<'light' | 'dark'>('dark');
	let draftDiffTheme = $state<string>('pierre');
	let draftAccent = $state<Accent>('super');
	let draftCodeFont = $state<string>('system');
	let draftUiFont = $state<string>('system');
	let draftIndentGuides = $state<boolean>(true);
	let draftEditor = $state<EditorKind | null>(null);
	let draftTerminal = $state<TerminalKind | null>(null);
	let draftChangesetsEnabled = $state<boolean>(true);
	let draftHotkeys = $state<Hotkeys>({ ...DEFAULT_HOTKEYS });

	// The diff theme the previews on this tab render with — tracks the in-progress
	// selection so the split/unified and code-font previews reflect it too.
	const draftDiffThemePair = $derived(diffThemePair(draftDiffTheme));

	$effect(() => {
		if (!dialogOpen) return;

		const tab = app.settingsDialogTab;
		const scrollTo = app.settingsDialogScrollTo;
		void app.settingsDialogScrollNonce;

		if (tab) {
			activeTab = tab;
			app.settingsDialogTab = null;
		}

		if (scrollTo) {
			app.settingsDialogScrollTo = null;
			const id = `settings-${scrollTo}`;
			void tick().then(async () => {
				await tick();
				document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			});
		}
	});

	// When the Updates tab is shown, kick off a check if we haven't asked recently
	// (once per session, or again after 5 minutes). The store throttles the call.
	$effect(() => {
		if (!dialogOpen || activeTab !== 'updates') return;
		actions.maybeCheckForUpdates();
	});

	function formatUpdateCheckedAt(ms: number): string {
		return new Date(ms).toLocaleTimeString(undefined, {
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	$effect(() => {
		if (dialogOpen) {
			searchQuery = '';
			// Start each session lean: clearing drops every tab's heavy content, and
			// the effect above immediately re-adds the tab being shown. Deliberately
			// does NOT read `activeTab` here — that would make this snapshot effect
			// depend on it and re-run (wiping the drafts) on every tab switch.
			mountedTabs.clear();
			snapshotDrafts();
		}
	});

	// Re-seed the drafts when the live settings are (re)applied while the dialog is
	// open — a settings.json edit, import, or reset (each bumps app.prefsVersion).
	// Without this a live external edit would be silently overwritten by the stale
	// drafts the next time the user hits Save. Does not clear mountedTabs, so the
	// heavy previews/panels stay mounted through a live change.
	$effect(() => {
		void app.prefsVersion;
		if (dialogOpen) snapshotDrafts();
	});

	// Snapshot the current app settings into the editable drafts. Applied on Save.
	function snapshotDrafts(): void {
		draftViewMode = app.viewMode;
		draftDiffLayout = app.diffLayout;
		draftShowFileIcons = app.showFileIcons;
		draftAnimations = app.animations;
		draftOpenFileOnArrowNav = app.openFileOnArrowNav;
		draftPrMergedBehavior = app.prMergedBehavior;
		draftAutoRemoveMergedBranch = app.autoRemoveMergedBranch;
		draftUnmarkSeenOnChange = app.unmarkSeenOnChange;
		draftSignCommits = app.signCommits;
		draftMaxDiffLines = app.maxDiffLines;
		draftRecentRepoCount = app.recentRepoCount;
		draftWindowWidth = app.windowWidth;
		draftWindowHeight = app.windowHeight;
		draftStartMaximized = app.startMaximized;
		draftHiddenDiffPatterns = [...app.hiddenDiffPatterns];
		newPattern = '';
		draftCustomFileIcons = app.customFileIcons.map((i) => ({ ...i }));
		newIconPattern = '';
		newIconSource = '';
		draftTheme = app.theme;
		draftDiffTheme = app.diffTheme;
		draftAccent = app.accent;
		draftCodeFont = app.codeFont;
		draftUiFont = app.uiFont;
		draftIndentGuides = app.indentGuides;
		draftEditor = effectiveEditor();
		draftTerminal = effectiveTerminal();
		draftChangesetsEnabled = app.changesetsEnabled;
		draftHotkeys = { ...DEFAULT_HOTKEYS, ...$state.snapshot(app.hotkeys) };
	}

	function setHotkey(action: HotkeyAction, hk: Hotkey): void {
		draftHotkeys = { ...draftHotkeys, [action]: hk };
	}

	function resetHotkeys(): void {
		draftHotkeys = { ...DEFAULT_HOTKEYS };
	}

	// What a binding collides with, if anything — drives the conflict highlight so
	// two actions can't silently share a combination, and so a binding can't land
	// on one the native menu already owns (which would never fire).
	function hotkeyConflict(action: HotkeyAction): string | null {
		const hk = draftHotkeys[action];
		for (const other of HOTKEY_ACTIONS) {
			if (other !== action && hotkeysEqual(draftHotkeys[other], hk)) {
				return HOTKEY_LABELS[other].label;
			}
		}
		return reservedHotkeyLabel(hk);
	}

	const hasHotkeyConflict = $derived(HOTKEY_ACTIONS.some((a) => hotkeyConflict(a) !== null));

	const hotkeysChanged = $derived(
		HOTKEY_ACTIONS.some((a) => !hotkeysEqual(draftHotkeys[a], app.hotkeys[a]))
	);

	const hotkeysAreDefault = $derived(
		HOTKEY_ACTIONS.every((a) => hotkeysEqual(draftHotkeys[a], DEFAULT_HOTKEYS[a]))
	);

	function addPattern(): void {
		const p = newPattern.trim();
		if (!p || draftHiddenDiffPatterns.includes(p)) {
			newPattern = '';
			return;
		}
		draftHiddenDiffPatterns = [...draftHiddenDiffPatterns, p];
		newPattern = '';
	}

	function removePattern(pattern: string): void {
		draftHiddenDiffPatterns = draftHiddenDiffPatterns.filter((p) => p !== pattern);
	}

	function resetPatterns(): void {
		draftHiddenDiffPatterns = [...DEFAULT_HIDDEN_DIFF_PATTERNS];
	}

	function arraysEqual(a: string[], b: string[]): boolean {
		return a.length === b.length && a.every((v, i) => v === b[i]);
	}

	function addCustomIcon(): void {
		const pattern = newIconPattern.trim();
		const source = newIconSource.trim();
		if (!pattern || !source) return;
		// Replace an existing row with the same pattern rather than duplicating it.
		const withoutDupe = draftCustomFileIcons.filter((i) => i.pattern !== pattern);
		draftCustomFileIcons = [...withoutDupe, { pattern, source }];
		newIconPattern = '';
		newIconSource = '';
	}

	async function pickIconFile(): Promise<void> {
		const picked = await window.api.icons.pickIconFile();
		if (picked) newIconSource = picked;
	}

	function removeCustomIcon(pattern: string): void {
		draftCustomFileIcons = draftCustomFileIcons.filter((i) => i.pattern !== pattern);
	}

	function customIconsEqual(a: CustomFileIcon[], b: CustomFileIcon[]): boolean {
		return (
			a.length === b.length &&
			a.every((v, i) => v.pattern === b[i].pattern && v.source === b[i].source)
		);
	}

	// Clamp a window dimension to its minimum, falling back to the default for
	// empty/invalid input. Matches the store's clampWindowDimension so what we
	// compare and save lines up with what gets persisted.
	function clampWindowDim(value: number, min: number, fallback: number): number {
		const n = Number(value);
		if (!Number.isFinite(n) || n <= 0) return fallback;
		return Math.max(min, Math.floor(n));
	}

	async function save(): Promise<void> {
		const promises: Promise<unknown>[] = [];
		if (draftViewMode !== app.viewMode) {
			promises.push(actions.setViewMode(draftViewMode));
		}
		if (draftDiffLayout !== app.diffLayout) {
			promises.push(actions.setDiffLayout(draftDiffLayout));
		}
		if (draftShowFileIcons !== app.showFileIcons) {
			promises.push(actions.setShowFileIcons(draftShowFileIcons));
		}
		if (draftAnimations !== app.animations) {
			promises.push(actions.setAnimations(draftAnimations));
		}
		if (draftOpenFileOnArrowNav !== app.openFileOnArrowNav) {
			promises.push(actions.setOpenFileOnArrowNav(draftOpenFileOnArrowNav));
		}
		if (draftIndentGuides !== app.indentGuides) {
			promises.push(actions.setIndentGuides(draftIndentGuides));
		}
		if (draftPrMergedBehavior !== app.prMergedBehavior) {
			promises.push(actions.setPrMergedBehavior(draftPrMergedBehavior));
		}
		if (draftAutoRemoveMergedBranch !== app.autoRemoveMergedBranch) {
			promises.push(actions.setAutoRemoveMergedBranch(draftAutoRemoveMergedBranch));
		}
		if (draftUnmarkSeenOnChange !== app.unmarkSeenOnChange) {
			promises.push(actions.setUnmarkSeenOnChange(draftUnmarkSeenOnChange));
		}
		if (draftSignCommits !== app.signCommits) {
			promises.push(actions.setSignCommits(draftSignCommits));
		}
		const parsedMaxDiffLines = Number(draftMaxDiffLines);
		const clampedMaxDiffLines =
			Number.isFinite(parsedMaxDiffLines) && parsedMaxDiffLines >= 0
				? Math.floor(parsedMaxDiffLines)
				: 0;
		if (clampedMaxDiffLines !== app.maxDiffLines) {
			promises.push(actions.setMaxDiffLines(clampedMaxDiffLines));
		}
		const parsedRecentRepoCount = Number(draftRecentRepoCount);
		const clampedRecentRepoCount =
			Number.isFinite(parsedRecentRepoCount) && parsedRecentRepoCount >= 0
				? Math.floor(parsedRecentRepoCount)
				: app.recentRepoCount;
		if (clampedRecentRepoCount !== app.recentRepoCount) {
			promises.push(actions.setRecentRepoCount(clampedRecentRepoCount));
		}
		if (!arraysEqual(draftHiddenDiffPatterns, app.hiddenDiffPatterns)) {
			promises.push(actions.setHiddenDiffPatterns(draftHiddenDiffPatterns));
		}
		if (!customIconsEqual(draftCustomFileIcons, app.customFileIcons)) {
			promises.push(actions.setCustomFileIcons(draftCustomFileIcons));
		}
		const clampedWindowWidth = clampWindowDim(
			draftWindowWidth,
			WINDOW_BOUNDS.minWidth,
			WINDOW_BOUNDS.defaultWidth
		);
		const clampedWindowHeight = clampWindowDim(
			draftWindowHeight,
			WINDOW_BOUNDS.minHeight,
			WINDOW_BOUNDS.defaultHeight
		);
		if (clampedWindowWidth !== app.windowWidth || clampedWindowHeight !== app.windowHeight) {
			promises.push(actions.setWindowSize(clampedWindowWidth, clampedWindowHeight));
		}
		if (draftStartMaximized !== app.startMaximized) {
			promises.push(actions.setStartMaximized(draftStartMaximized));
		}
		if (draftTheme !== app.theme) {
			promises.push(actions.setTheme(draftTheme));
		}
		if (draftDiffTheme !== app.diffTheme) {
			promises.push(actions.setDiffTheme(draftDiffTheme));
		}
		if (draftAccent !== app.accent) {
			promises.push(actions.setAccent(draftAccent));
		}
		if (draftCodeFont !== app.codeFont) {
			promises.push(actions.setCodeFont(draftCodeFont));
		}
		if (draftUiFont !== app.uiFont) {
			promises.push(actions.setUiFont(draftUiFont));
		}
		const savedEditor = app.prefs?.externalEditor ?? null;
		if (draftEditor !== savedEditor) {
			promises.push(actions.setExternalEditor(draftEditor));
		}
		const savedTerminal = app.prefs?.externalTerminal ?? null;
		if (draftTerminal !== savedTerminal) {
			promises.push(actions.setExternalTerminal(draftTerminal));
		}
		if (draftChangesetsEnabled !== app.changesetsEnabled) {
			promises.push(actions.setChangesetsEnabled(draftChangesetsEnabled));
		}
		if (hotkeysChanged) {
			promises.push(actions.setHotkeys($state.snapshot(draftHotkeys)));
		}
		await Promise.all(promises);
		actions.closeSettingsDialog();
	}

	function cancel(): void {
		actions.closeSettingsDialog();
	}

	function startAddAccount(): void {
		actions.openGithubSignIn();
	}

	async function removeAccount(id: string): Promise<void> {
		await actions.removeGithubAccount(id);
	}

	async function setDefaultAccount(id: string): Promise<void> {
		await actions.setDefaultGithubAccount(id);
	}
</script>

{#snippet editorIcon(editor: EditorKind, size: string = 'size-5')}
	{#if editor === 'cursor'}
		<CursorIcon class={size} />
	{:else if editor === 'vscode'}
		<VSCodeIcon class="{size} text-foreground" />
	{:else if editor === 'zed'}
		<ZedIcon class="{size} text-foreground" />
	{:else if editor === 'xcode'}
		<XcodeIcon class={size} />
	{:else}
		<VisualStudioIcon class={size} />
	{/if}
{/snippet}

{#snippet terminalIcon(terminal: TerminalKind)}
	{#if terminal === 'ghostty'}
		<GhostIcon class="size-5" />
	{:else if terminal === 'warp'}
		<WarpIcon class="size-5 rounded-[3px]" />
	{:else if terminal === 'iterm'}
		<ITermIcon class="size-5 rounded-[3px]" />
	{:else if terminal === 'terminal'}
		<TerminalAppIcon class="size-5" />
	{:else if terminal === 'powershell'}
		<PowerShellIcon class="size-5" />
	{:else}
		<ZshIcon class="size-5 text-foreground" />
	{/if}
{/snippet}

<!-- Optional header action for a section, dispatched by id. Only sections with
	`hasReset` render one. -->
{#snippet sectionReset(id: string)}
	{#if id === 'settings-hidden-files'}
		{#if !arraysEqual([...draftHiddenDiffPatterns].sort(), [...DEFAULT_HIDDEN_DIFF_PATTERNS].sort())}
			<Button variant="ghost" size="sm" onclick={resetPatterns}>
				<RotateCcw class="size-3.5" /> Reset to defaults
			</Button>
		{/if}
	{:else if id === 'settings-hotkeys'}
		{#if !hotkeysAreDefault}
			<Button variant="ghost" size="sm" onclick={resetHotkeys}>
				<RotateCcw class="size-3.5" /> Reset to defaults
			</Button>
		{/if}
	{/if}
{/snippet}

<!-- The body markup for a section, dispatched by id. The wrapper, heading, and
	header action are rendered by the loop in the content snippet; everything
	below the heading lives here. Each branch corresponds to one SECTIONS entry. -->
{#snippet sectionBody(id: string)}
	{#if id === 'settings-super-review'}
		{@const lic = app.license.current}
		{@const holder = lic?.state === 'licensed' ? lic.holder : undefined}
		{#if lic?.state === 'licensed' && (lic.plan === 'lifetime' || lic.plan === 'monthly' || lic.plan === 'annual') && lic.status === 'active'}
			<!-- Paid license: the metal card. The holder comes from the signed token,
				so it's the account the license actually belongs to (NOT whatever
				GitHub account happens to be signed in locally - they're separate). -->
			<p class="mt-1 text-xs text-muted-foreground">Your Super Review license.</p>
			<div class="mt-3 flex flex-col items-center">
				<LicenseCard
					variant={lic.plan === 'lifetime' ? 'gold' : 'silver'}
					plan={lic.plan === 'lifetime'
						? 'Perpetual'
						: lic.plan === 'annual'
							? 'Annual'
							: 'Monthly'}
					holder={holder?.name ?? holder?.email}
					activeSince={lic.activeSince}
				/>
				<Button
					variant="outline"
					size="sm"
					class="mt-4"
					onclick={() => actions.openLicenseDashboard()}
				>
					<ExternalLink class="size-3.5" /> Manage license
				</Button>
			</div>
		{:else if lic?.state === 'licensed' && lic.status === 'trialing'}
			{@const days = lic.trialEndsAt
				? Math.max(0, Math.ceil((lic.trialEndsAt - Date.now()) / 86_400_000))
				: 0}
			<p class="mt-1 text-xs text-muted-foreground">You're on a free trial.</p>
			<div
				class="mt-3 flex items-center justify-between rounded-xl border border-border bg-card/30 px-3 py-2.5"
			>
				<div>
					<div class="text-sm font-medium">Free trial</div>
					<div class="text-xs text-muted-foreground">
						{days === 0 ? 'Ends today' : `${days} day${days === 1 ? '' : 's'} left`}
					</div>
				</div>
				<Button size="sm" onclick={() => actions.openPricing()}>Upgrade</Button>
			</div>
			<Button
				variant="outline"
				size="sm"
				class="mt-3"
				onclick={() => actions.openLicenseDashboard()}
			>
				<ExternalLink class="size-3.5" /> Manage license
			</Button>
		{:else}
			<p class="mt-1 text-xs text-muted-foreground">Manage your Super Review license.</p>
			<Button size="sm" class="mt-3" onclick={() => actions.openPricing()}>See plans</Button>
		{/if}

		{#if lic?.state === 'licensed'}
			<!-- The account this license is signed in as, with sign out. -->
			<div class="mt-5 text-xs font-medium text-muted-foreground">Signed in as</div>
			<div
				class="mt-2 flex items-center gap-3 rounded-xl border border-border bg-card/30 px-3 py-2.5"
			>
				{#if holder?.name || holder?.email}
					{@const label = holder.name ?? holder.email ?? ''}
					<Avatar.Root class="size-8">
						{#if holder.avatarUrl}
							<Avatar.Image src={holder.avatarUrl} alt={label} />
						{/if}
						<Avatar.Fallback class="text-[10px]">
							{label.slice(0, 2).toUpperCase()}
						</Avatar.Fallback>
					</Avatar.Root>
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-medium">{holder.name ?? holder.email}</div>
						{#if holder.name && holder.email}
							<div class="truncate text-xs text-muted-foreground">{holder.email}</div>
						{/if}
					</div>
				{:else}
					<div class="min-w-0 flex-1 text-sm text-muted-foreground">Super Review account</div>
				{/if}
				<Button variant="outline" size="sm" onclick={() => actions.signOutLicense()}>
					<LogOut class="size-3.5" /> Sign out
				</Button>
			</div>
		{/if}
	{:else if id === 'settings-accounts-github'}
		{#if app.githubAccounts.length === 0}
			<p class="mt-1 text-xs text-muted-foreground">
				Sign in to review pull requests and post comments.
			</p>
		{:else}
			<p class="mt-1 text-xs text-muted-foreground">
				The default account is used by projects that haven't picked their own.
			</p>
		{/if}
		{#if app.githubAccounts.length === 0}
			<Button size="sm" class="mt-3" onclick={startAddAccount}>
				<Plus class="size-3.5" /> Sign in to GitHub
			</Button>
		{:else}
			<div class="mt-3 overflow-hidden rounded-xl border border-border bg-card/30">
				{#each app.githubAccounts as acct (acct.id)}
					{@const isDefault = acct.id === app.activeGithubAccount?.id}
					<div
						class="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0"
					>
						<Avatar.Root class="size-8">
							{#if acct.avatarUrl}
								<Avatar.Image src={acct.avatarUrl} alt={acct.login} />
							{/if}
							<Avatar.Fallback class="text-[10px]">
								{acct.login.slice(0, 2).toUpperCase()}
							</Avatar.Fallback>
						</Avatar.Root>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium">
								{acct.name ?? acct.login}
							</div>
							<div class="truncate text-xs text-muted-foreground">
								@{acct.login}
							</div>
						</div>
						{#if isDefault}
							<span
								class="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success"
							>
								<Check class="size-3" /> Default
							</span>
						{:else}
							<Button variant="ghost" size="sm" onclick={() => setDefaultAccount(acct.id)}>
								Set as default
							</Button>
						{/if}
						<Button
							variant="ghost"
							size="icon-sm"
							title={`Sign out ${acct.login}`}
							onclick={() => removeAccount(acct.id)}
						>
							<LogOut class="size-3.5" />
						</Button>
					</div>
				{/each}
			</div>
			<Button variant="outline" size="sm" class="mt-3" onclick={startAddAccount}>
				<Plus class="size-3.5" /> Add another account
			</Button>
		{/if}
	{:else if id === 'settings-hidden-files'}
		<p class="mt-1 text-xs text-muted-foreground">
			Glob patterns whose diffs are hidden behind a "Load diff" button.
		</p>

		<div class="mt-3 overflow-hidden rounded-xl border border-border bg-card/30">
			<div class="flex gap-2 p-2.5">
				<Input
					placeholder="e.g. *.min.js or dist/**"
					bind:value={newPattern}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addPattern();
						}
					}}
					class="h-8 flex-1"
				/>
				<Button variant="outline" onclick={addPattern}>
					<Plus class="size-3.5" /> Add
				</Button>
			</div>
			{#if draftHiddenDiffPatterns.length === 0}
				<p class="border-t border-border/60 px-3 py-3 text-xs text-muted-foreground">
					No patterns. Every file's diff renders inline.
				</p>
			{:else}
				<div class="max-h-[220px] overflow-y-auto border-t border-border/60">
					{#each draftHiddenDiffPatterns as pattern (pattern)}
						<div
							class="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
						>
							<span class="truncate font-mono text-xs">{pattern}</span>
							<button
								type="button"
								class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
								title={`Remove ${pattern}`}
								onclick={() => removePattern(pattern)}
							>
								<X class="size-3.5" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else if id === 'settings-custom-file-icons'}
		<p class="mt-1 text-xs text-muted-foreground">
			Give files matching a glob pattern your own icon.
		</p>

		<div class="mt-3 overflow-hidden rounded-xl border border-border bg-card/30">
			<div class="flex gap-2 p-2.5">
				<Input placeholder="Pattern, e.g. *.proto" bind:value={newIconPattern} class="h-8 flex-1" />
				<Input
					placeholder="https://… or /path/to/icon.svg"
					bind:value={newIconSource}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							addCustomIcon();
						}
					}}
					class="h-8 flex-1"
				/>
				<Button variant="outline" size="icon" onclick={pickIconFile} title="Choose a local image">
					<FolderOpen class="size-3.5" />
				</Button>
				<Button variant="outline" onclick={addCustomIcon}>
					<Plus class="size-3.5" /> Add
				</Button>
			</div>
			{#if draftCustomFileIcons.length === 0}
				<p class="border-t border-border/60 px-3 py-3 text-xs text-muted-foreground">
					No custom icons. Files use their built-in language icons.
				</p>
			{:else}
				<div class="max-h-[220px] overflow-y-auto border-t border-border/60">
					{#each draftCustomFileIcons as icon (icon.pattern)}
						<div
							class="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
						>
							<span class="grid size-5 shrink-0 place-items-center">
								{#await resolveIconSrc(icon.source) then src}
									{#if src}
										<img {src} alt="" class="size-4 object-contain" />
									{:else}
										<span class="text-muted-foreground" title="Couldn't load this icon">—</span>
									{/if}
								{/await}
							</span>
							<span class="shrink-0 font-mono text-xs">{icon.pattern}</span>
							<span class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
								{icon.source}
							</span>
							<button
								type="button"
								class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
								title={`Remove ${icon.pattern}`}
								onclick={() => removeCustomIcon(icon.pattern)}
							>
								<X class="size-3.5" />
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else if id === 'settings-updates'}
		{@const u = app.update}
		<p class="mt-1 text-xs text-muted-foreground">
			Super Review updates in the background and installs when you quit.
		</p>

		<!-- Apple-style stacked inset groups: status flow on top, then installed
			version and the (beta-locked) automatic-updates toggle. Fixed min-height
			on each row so the Restart button appearing doesn't hop the layout. -->
		<div class="mt-3 space-y-2">
			<div
				class="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-border bg-card/30 px-3 py-2.5"
			>
				{#if u.state === 'checking'}
					<Spinner class="size-4 shrink-0 text-muted-foreground">
						{#snippet child({ props })}
							<Loader {...props} />
						{/snippet}
					</Spinner>
					<span class="text-sm">Checking for updates...</span>
				{:else if u.state === 'available' || u.state === 'downloading'}
					<Spinner class="size-4 shrink-0 text-muted-foreground">
						{#snippet child({ props })}
							<Loader {...props} />
						{/snippet}
					</Spinner>
					<span class="min-w-0 flex-1 truncate text-sm">
						Installing {u.version ? `${u.version}` : 'update'}...
					</span>
					{#if u.state === 'downloading'}
						<span class="shrink-0 text-xs tabular-nums text-muted-foreground">{u.percent}%</span>
					{/if}
				{:else if u.state === 'downloaded'}
					<TriangleAlert class="size-4 shrink-0 text-warning" />
					<span class="min-w-0 flex-1 truncate text-sm">
						Version {u.version} available
					</span>
					<Button size="sm" class="shrink-0" onclick={() => actions.restartToUpdate()}>
						Restart
					</Button>
				{:else if u.state === 'error'}
					<TriangleAlert class="size-4 shrink-0 text-destructive" />
					<span class="min-w-0 flex-1 truncate text-sm" title={u.message}>
						Couldn't check for updates
					</span>
				{:else if app.updateCheckedAt !== null}
					<CloudCheck class="size-4 shrink-0 text-muted-foreground" />
					<span class="text-sm">
						Up to date. Checked at {formatUpdateCheckedAt(app.updateCheckedAt)}
					</span>
				{:else}
					<Spinner class="size-4 shrink-0 text-muted-foreground">
						{#snippet child({ props })}
							<Loader {...props} />
						{/snippet}
					</Spinner>
					<span class="text-sm">Checking for updates...</span>
				{/if}
			</div>

			<div
				class="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-border bg-card/30 px-3 py-2.5"
			>
				<span class="text-sm">Installed</span>
				<span class="text-sm tabular-nums text-muted-foreground">
					{app.appVersion ? `v${app.appVersion}` : ''}
				</span>
			</div>

			<div
				class="flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-border bg-card/30 px-3 py-2.5"
			>
				<span class="text-sm">Automatic Updates</span>
				<!-- Beta: locked on. Pref is wired (app.automaticUpdates) but the
					control stays disabled so users can't opt out yet. -->
				<Switch checked={true} disabled aria-label="Automatic Updates" />
			</div>
		</div>
	{:else if id === 'settings-external-editor'}
		<p class="mt-1 text-xs text-muted-foreground">Used by the "Open in editor" button.</p>

		<div class="mt-3 overflow-hidden rounded-xl border border-border bg-card/30">
			{#each sortedEditors as ed (ed)}
				{@const installed = app.editors[ed]}
				{@const selected = draftEditor === ed}
				<button
					type="button"
					disabled={!installed}
					class={cn(
						'flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0',
						!installed
							? 'cursor-not-allowed opacity-50'
							: selected
								? 'bg-primary/5'
								: 'hover:bg-muted/40'
					)}
					onclick={() => installed && (draftEditor = ed)}
				>
					{@render editorIcon(ed)}
					<span class="flex-1 text-sm">{EDITOR_LABELS[ed]}</span>
					{#if !installed}
						<span class="text-xs text-muted-foreground">Not installed</span>
					{:else if selected}
						<Check class="size-4 text-primary" />
					{/if}
				</button>
			{/each}
		</div>
	{:else if id === 'settings-terminal'}
		<p class="mt-1 text-xs text-muted-foreground">Used by the "Open in terminal" button.</p>

		<div class="mt-3 overflow-hidden rounded-xl border border-border bg-card/30">
			{#each sortedTerminals as t (t)}
				{@const installed = app.terminals[t]}
				{@const selected = draftTerminal === t}
				<button
					type="button"
					disabled={!installed}
					class={cn(
						'flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0',
						!installed
							? 'cursor-not-allowed opacity-50'
							: selected
								? 'bg-primary/5'
								: 'hover:bg-muted/40'
					)}
					onclick={() => installed && (draftTerminal = t)}
				>
					{@render terminalIcon(t)}
					<span class="flex-1 text-sm">{TERMINAL_LABELS[t]}</span>
					{#if !installed}
						<span class="text-xs text-muted-foreground">Not installed</span>
					{:else if selected}
						<Check class="size-4 text-primary" />
					{/if}
				</button>
			{/each}
		</div>
	{:else if id === 'settings-hotkeys'}
		<p class="mt-1 text-xs text-muted-foreground">
			Click a shortcut, then press the keys you want. <kbd class="font-mono">Esc</kbd> cancels.
		</p>

		<div class="mt-3 overflow-hidden rounded-xl border border-border bg-card/30">
			{#each HOTKEY_ACTIONS as action (action)}
				{@const conflictWith = hotkeyConflict(action)}
				<div class="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0">
					<div class="min-w-0 flex-1">
						<div class="text-sm font-medium">
							{HOTKEY_LABELS[action].label}
						</div>
						<div class="text-xs text-muted-foreground">
							{#if conflictWith}
								<span class="text-destructive">
									Conflicts with “{conflictWith}”.
								</span>
							{:else}
								{HOTKEY_LABELS[action].description}
							{/if}
						</div>
					</div>
					<HotkeyInput
						value={draftHotkeys[action]}
						conflict={conflictWith !== null}
						onChange={(hk) => setHotkey(action, hk)}
					/>
				</div>
			{/each}
		</div>
	{:else if id === 'settings-agents'}
		<!-- Gated on first visit so the panel only mounts (and runs its onMount IPC)
			once the user opens Agents, even though every tab's text stays in the DOM
			for search. It stays mounted afterwards so returning is instant. -->
		{#if mountedTabs.has('agents')}
			<AgentsSettingsPanel />
		{/if}
	{:else if id === 'settings-stats'}
		{#if mountedTabs.has('stats')}
			<UsageStatsPanel />
		{/if}
	{/if}
{/snippet}

<!-- One settings section: its `id` (so search can scroll/flash it), heading +
	optional reset, and the dispatched body. -->
{#snippet sectionWrapper(s: SettingsSection)}
	<div id={s.id} class="scroll-mt-4 rounded-lg">
		{#if s.title}
			<div class="flex items-center justify-between gap-2">
				<h3 class="text-base font-semibold">{s.title}</h3>
				{#if s.hasReset}
					{@render sectionReset(s.id)}
				{/if}
			</div>
		{/if}
		{@render sectionBody(s.id)}
	</div>
{/snippet}

<!-- The single basic control for a `row` section, dispatched by id: a switch,
	select, or input so every settings tab reads as one consistent list. -->
{#snippet compactControl(id: string)}
	{#if id === 'settings-theme'}
		<SettingSelect
			ariaLabel="Theme"
			value={draftTheme}
			options={[
				{ value: 'light', label: 'Light' },
				{ value: 'dark', label: 'Dark' }
			]}
			onChange={(v) => (draftTheme = v as 'light' | 'dark')}
		/>
	{:else if id === 'settings-accent'}
		<SettingSelect
			ariaLabel="Accent"
			value={draftAccent}
			options={ACCENTS.map((a) => ({ value: a.id, label: a.label, swatch: a.primary }))}
			onChange={(v) => (draftAccent = v as Accent)}
		/>
	{:else if id === 'settings-ui-font'}
		<SettingSelect
			ariaLabel="UI font"
			value={draftUiFont}
			options={UI_FONTS}
			onChange={(f) => (draftUiFont = f)}
		/>
	{:else if id === 'settings-file-icons'}
		<Switch bind:checked={draftShowFileIcons} aria-label="Show file icons" />
	{:else if id === 'settings-animations'}
		<SettingSelect
			ariaLabel="Animations"
			value={draftAnimations}
			options={[
				{ value: 'none', label: 'None' },
				{ value: 'accents', label: 'Accents only' },
				{ value: 'all', label: 'All' }
			]}
			onChange={(v) => (draftAnimations = v as AnimationMode)}
		/>
	{:else if id === 'settings-diff-view'}
		<SettingSelect
			ariaLabel="Diff view"
			value={draftViewMode}
			options={[
				{ value: 'split', label: 'Split' },
				{ value: 'unified', label: 'Unified' }
			]}
			onChange={(v) => (draftViewMode = v as ViewMode)}
		/>
	{:else if id === 'settings-diff-layout'}
		<SettingSelect
			ariaLabel="Diff layout"
			value={draftDiffLayout}
			options={[
				{ value: 'scroll', label: 'Scrollable' },
				{ value: 'single', label: 'One at a time' }
			]}
			onChange={(v) => (draftDiffLayout = v as DiffLayout)}
		/>
	{:else if id === 'settings-diff-theme'}
		<SettingSelect
			ariaLabel="Diff theme"
			value={draftDiffTheme}
			options={DIFF_THEMES.map((t) => ({ value: t.id, label: t.label }))}
			onChange={(v) => (draftDiffTheme = v)}
		/>
	{:else if id === 'settings-code-font'}
		<SettingSelect
			ariaLabel="Code font"
			value={draftCodeFont}
			options={CODE_FONTS}
			onChange={(f) => (draftCodeFont = f)}
		/>
	{:else if id === 'settings-indent-guides'}
		<Switch bind:checked={draftIndentGuides} aria-label="Indent guides" />
	{:else if id === 'settings-arrow-nav'}
		<SettingSelect
			ariaLabel="Arrow-key navigation"
			value={draftOpenFileOnArrowNav ? 'arrow' : 'enter'}
			options={[
				{ value: 'arrow', label: 'Open on arrow' },
				{ value: 'enter', label: 'Open on enter' }
			]}
			onChange={(v) => (draftOpenFileOnArrowNav = v === 'arrow')}
		/>
	{:else if id === 'settings-merged-branches'}
		<SettingSelect
			ariaLabel="When a PR is merged"
			value={draftPrMergedBehavior}
			options={[
				{ value: 'prompt', label: 'Ask before switching' },
				{ value: 'switch', label: 'Switch automatically' },
				{ value: 'nothing', label: 'Never ask' }
			]}
			onChange={(v) => (draftPrMergedBehavior = v as PrMergedBehavior)}
		/>
	{:else if id === 'settings-auto-remove-merged'}
		<Switch bind:checked={draftAutoRemoveMergedBranch} aria-label="Auto-remove merged branches" />
	{:else if id === 'settings-reviewing'}
		<Switch
			bind:checked={draftUnmarkSeenOnChange}
			aria-label="Unmark seen files when they change"
		/>
	{:else if id === 'settings-commits'}
		<Switch bind:checked={draftSignCommits} aria-label="Sign my commits" />
	{:else if id === 'settings-recent-repos'}
		<Input type="number" min="0" step="1" bind:value={draftRecentRepoCount} class="h-8 w-24" />
	{:else if id === 'settings-large-diffs'}
		<Input type="number" min="0" step="100" bind:value={draftMaxDiffLines} class="h-8 w-24" />
	{:else if id === 'settings-window-size'}
		<div class="flex items-center gap-2">
			<Input
				type="number"
				min={WINDOW_BOUNDS.minWidth}
				step="10"
				bind:value={draftWindowWidth}
				disabled={draftStartMaximized}
				class="h-8 w-20"
				aria-label="Window width"
			/>
			<span class="text-muted-foreground">×</span>
			<Input
				type="number"
				min={WINDOW_BOUNDS.minHeight}
				step="10"
				bind:value={draftWindowHeight}
				disabled={draftStartMaximized}
				class="h-8 w-20"
				aria-label="Window height"
			/>
		</div>
	{:else if id === 'settings-start-maximized'}
		<Switch bind:checked={draftStartMaximized} aria-label="Start maximized" />
	{:else if id === 'settings-changesets'}
		<Switch bind:checked={draftChangesetsEnabled} aria-label="Enable Changesets" />
	{/if}
{/snippet}

<!-- One uniform settings row inside a card: title + blurb on the left, one basic
	control on the right. `id` lets search scroll to and flash it. -->
{#snippet settingRow(s: SettingsSection)}
	{@const centered = s.id === 'settings-changesets'}
	<div
		id={s.id}
		class={cn(
			'flex scroll-mt-4 justify-between gap-6 border-b border-border/60 px-4 py-3.5 last:border-b-0',
			centered ? 'items-center' : 'items-start'
		)}
	>
		<div class={cn('flex min-w-0 gap-3', centered ? 'items-center' : 'items-start')}>
			{#if s.id === 'settings-changesets'}
				<div
					class="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-card"
				>
					<ChangesetLogo class="h-4 w-auto" />
				</div>
			{/if}
			<div class="min-w-0">
				<h3 class="text-sm font-medium">{s.title ?? s.label}</h3>
				{#if s.description}
					<p class="mt-0.5 text-xs text-muted-foreground">{s.description}</p>
				{/if}
			</div>
		</div>
		<div class={cn('shrink-0', centered ? '' : 'pt-0.5')}>{@render compactControl(s.id)}</div>
	</div>
{/snippet}

<!-- The single shared live preview for the Appearance or Diff tab: one diff preview
	reflecting view mode + diff theme + code font, or one chrome preview reflecting
	theme + accent + UI font + file icons. Rendered large so it's the focus of the
	tab now that the controls are compact. -->
{#snippet tabPreview(kind: 'chrome' | 'diff')}
	<div class="mt-5">
		<div class="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
			Preview
		</div>
		{#if kind === 'diff'}
			<!-- Framed like a real DiffFileSection card: shared header chrome above an
				edge-to-edge DiffStylePreview (no extra padding around the diff). -->
			<div
				class="overflow-hidden rounded-lg border border-border bg-background"
				style="--code-font: {codeFontCss(draftCodeFont)}; --code-font-features: {codeFontFeatures(
					draftCodeFont
				)};"
			>
				<DiffFileHeader
					path="src/cart.ts"
					expanded
					sticky={false}
					interactive={false}
					additions={3}
					deletions={5}
					showViewToggle
					showRaw={false}
					markSeenHotkey={formatHotkeyParts(app.hotkeys.markSeenNext, app.platform === 'darwin')}
				/>
				<div class="bg-card/20">
					<DiffStylePreview
						mode={draftViewMode}
						theme={draftDiffThemePair}
						indentGuides={draftIndentGuides}
					/>
				</div>
			</div>
		{:else}
			<div class="overflow-hidden rounded-lg border border-border bg-background p-3">
				<AppChromePreview
					theme={draftTheme}
					accent={draftAccent}
					uiFont={draftUiFont}
					showIcons={draftShowFileIcons}
				/>
			</div>
		{/if}
	</div>
{/snippet}

<!-- A whole tab: each run of `row` sections becomes one card; `block` sections
	render standalone in declared order. Previewable tabs append the shared preview. -->
{#snippet tabContent(tab: SettingsTab)}
	{@const previewKind = TAB_PREVIEW[tab]}
	<div class="space-y-6">
		{#each segmentsForTab(tab) as seg, i (i)}
			{#if seg.type === 'card'}
				<div class="overflow-hidden rounded-xl border border-border bg-card/30">
					{#each seg.sections as s (s.id)}
						{@render settingRow(s)}
					{/each}
				</div>
			{:else}
				{@render sectionWrapper(seg.section)}
			{/if}
		{/each}
		{#if previewKind && mountedTabs.has(tab)}
			{@render tabPreview(previewKind)}
		{/if}
	</div>
{/snippet}

{#snippet searchBox()}
	<div class="space-y-1">
		<div class="relative">
			<Search
				class="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				bind:value={searchQuery}
				placeholder="Search settings"
				aria-label="Search settings"
				class="h-8 pr-7 pl-7"
				onkeydown={handleSearchKey}
			/>
			{#if searchQuery}
				<button
					type="button"
					title="Clear search"
					class="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
					onclick={() => (searchQuery = '')}
				>
					<X class="size-3.5" />
				</button>
			{/if}
		</div>
	</div>
{/snippet}

<!-- While searching, this replaces the tab rail: a flat list of matching settings
	(name + tab). Picking one jumps to it and flashes it. -->
{#snippet searchNav()}
	{#if searchResults.length === 0}
		<p class="px-2 py-3 text-xs text-muted-foreground">No settings match “{trimmedQuery}”.</p>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
			{#each searchResults as hit, i (hit.section.id)}
				{@const active = i === highlightedIndex}
				<button
					type="button"
					data-search-result={i}
					class={cn(
						'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
						active ? 'bg-muted text-foreground' : 'text-muted-foreground'
					)}
					onmousemove={() => (highlightedIndex = i)}
					onclick={() => goToSetting(hit.section)}
				>
					<span class="min-w-0 flex-1 truncate">{hit.section.title ?? hit.section.label}</span>
					<span class="shrink-0 text-[10px] text-muted-foreground">{hit.tabLabel}</span>
				</button>
			{/each}
		</div>
	{/if}
{/snippet}

<!-- The settings dotfile lives in a dropup pinned to the bottom of the nav rail,
	rather than a content section, so it stays one click away from every tab. Its
	menu is portaled, so it is never clipped by the dialog. -->
{#snippet settingsFileMenu()}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger
			class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
			title={settingsPath}
		>
			<FileJson class="size-4 shrink-0" />
			<span class="min-w-0 flex-1 truncate">Settings file</span>
			<ChevronUp class="size-3.5 shrink-0 opacity-60" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content side="top" align="start" class="min-w-[220px]">
			<DropdownMenu.Item onSelect={() => actions.openSettingsFile()}>
				{#if settingsFileEditor}
					{@render editorIcon(settingsFileEditor, 'size-4')}
					Open in {EDITOR_LABELS[settingsFileEditor]}
				{:else}
					<ExternalLink class="size-4" /> Open externally
				{/if}
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => actions.revealSettingsFile()}>
				<FolderOpen class="size-4" /> Reveal
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => actions.exportSettings()}>
				<Download class="size-4" /> Export…
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={() => actions.importSettings()}>
				<Upload class="size-4" /> Import…
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => actions.resetSettings()}>
				<RotateCcw class="size-4" /> Reset to defaults
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<SettingsShell
	bind:open={dialogOpen}
	title="Settings"
	tabs={navTabs}
	bind:activeTab
	onClose={cancel}
	search={searchBox}
	navReplacement={searching ? searchNav : undefined}
	navFooter={settingsFileMenu}
	size="lg"
>
	{#snippet content(_tab)}
		<!-- Every tab's sections stay mounted (only the active one is shown) so the
			search jump-list can scroll to any section; heavy previews/panels are gated on
			the active tab so they don't mount up front. -->
		<div>
			{#each TABS as tab (tab.id)}
				<div hidden={activeTab !== tab.id}>
					{@render tabContent(tab.id)}
				</div>
			{/each}
		</div>
	{/snippet}

	{#snippet footer()}
		<Button variant="secondary" size="sm" onclick={cancel}>Cancel</Button>
		<Button size="sm" onclick={save} disabled={hasHotkeyConflict}>Save</Button>
	{/snippet}
</SettingsShell>
