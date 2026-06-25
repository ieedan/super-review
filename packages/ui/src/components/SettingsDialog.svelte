<script lang="ts">
	import { tick } from 'svelte';
	import AppWindow from '@lucide/svelte/icons/app-window';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Code2 from '@lucide/svelte/icons/code-2';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Keyboard from '@lucide/svelte/icons/keyboard';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Palette from '@lucide/svelte/icons/palette';
	import Plus from '@lucide/svelte/icons/plus';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import User from '@lucide/svelte/icons/user';
	import X from '@lucide/svelte/icons/x';
	import SettingsShell from './SettingsShell.svelte';
	import * as Avatar from './ui/avatar';
	import * as DropdownMenu from './ui/dropdown-menu';
	import { Button, buttonVariants } from './ui/button';
	import { Checkbox } from './ui/checkbox';
	import { Switch } from './ui/switch';
	import { Input } from './ui/input';
	import * as Table from './ui/table';
	import CursorIcon from './icons/CursorIcon.svelte';
	import VSCodeIcon from './icons/VSCodeIcon.svelte';
	import XcodeIcon from './icons/XcodeIcon.svelte';
	import ZedIcon from './icons/ZedIcon.svelte';
	import VisualStudioIcon from './icons/VisualStudioIcon.svelte';
	import GhostIcon from './icons/GhostIcon.svelte';
	import WarpIcon from './icons/WarpIcon.svelte';
	import ITermIcon from './icons/ITermIcon.svelte';
	import TerminalAppIcon from './icons/TerminalAppIcon.svelte';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import PowerShellIcon from './icons/PowerShellIcon.svelte';
	import ZshIcon from './icons/ZshIcon.svelte';
	import DiffStylePreview from './DiffStylePreview.svelte';
	import FileListPreview from './FileListPreview.svelte';
	import FontPicker from './FontPicker.svelte';
	import SettingOptionCard from './SettingOptionCard.svelte';
	import ThemePreview from './ThemePreview.svelte';
	import {
		actions,
		app,
		codeFontCss,
		effectiveEditor,
		effectiveTerminal,
		uiFontCss,
		type SettingsTab
	} from '@super-review/ui/store.svelte';
	import HotkeyInput from './HotkeyInput.svelte';
	import { DEFAULT_HIDDEN_DIFF_PATTERNS } from '@super-review/core/diff-defer';
	import {
		DEFAULT_HOTKEYS,
		HOTKEY_ACTIONS,
		HOTKEY_LABELS,
		hotkeysEqual,
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
	import { DIFF_THEMES, diffThemePair, resolveDiffThemePreset } from '@super-review/ui/diff-themes';
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

	const TABS: { id: SettingsTab; label: string; icon: typeof User }[] = [
		{ id: 'accounts', label: 'Accounts', icon: User },
		{ id: 'appearance', label: 'Appearance', icon: Palette },
		{ id: 'behavior', label: 'Behavior', icon: SlidersHorizontal },
		{ id: 'app', label: 'App', icon: AppWindow },
		{ id: 'editor', label: 'Integrations', icon: Code2 },
		{ id: 'hotkeys', label: 'Hotkeys', icon: Keyboard }
	];

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
	let draftEditor = $state<EditorKind | null>(null);
	let draftTerminal = $state<TerminalKind | null>(null);
	let draftChangesetsEnabled = $state<boolean>(true);
	let draftHotkeys = $state<Hotkeys>({ ...DEFAULT_HOTKEYS });

	// The diff theme the previews on this tab render with — tracks the in-progress
	// selection so the split/unified and code-font previews reflect it too.
	const draftDiffThemePair = $derived(diffThemePair(draftDiffTheme));
	const draftDiffThemeLabel = $derived(resolveDiffThemePreset(draftDiffTheme).label);

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

	$effect(() => {
		if (dialogOpen) {
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
			draftEditor = effectiveEditor();
			draftTerminal = effectiveTerminal();
			draftChangesetsEnabled = app.changesetsEnabled;
			draftHotkeys = { ...DEFAULT_HOTKEYS, ...$state.snapshot(app.hotkeys) };
		}
	});

	function setHotkey(action: HotkeyAction, hk: Hotkey): void {
		draftHotkeys = { ...draftHotkeys, [action]: hk };
	}

	function resetHotkeys(): void {
		draftHotkeys = { ...DEFAULT_HOTKEYS };
	}

	// The other action a binding collides with, if any — drives the conflict
	// highlight so two actions can't silently share the same combination.
	function hotkeyConflict(action: HotkeyAction): HotkeyAction | null {
		const hk = draftHotkeys[action];
		for (const other of HOTKEY_ACTIONS) {
			if (other !== action && hotkeysEqual(draftHotkeys[other], hk)) {
				return other;
			}
		}
		return null;
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

{#snippet editorIcon(editor: EditorKind)}
	{#if editor === 'cursor'}
		<CursorIcon class="size-5" />
	{:else if editor === 'vscode'}
		<VSCodeIcon class="size-5 text-foreground" />
	{:else if editor === 'zed'}
		<ZedIcon class="size-5 text-foreground" />
	{:else if editor === 'xcode'}
		<XcodeIcon class="size-5" />
	{:else}
		<VisualStudioIcon class="size-5" />
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

<SettingsShell bind:open={dialogOpen} title="Settings" tabs={TABS} bind:activeTab onClose={cancel}>
	{#snippet content(_tab)}
		{#if activeTab === 'accounts'}
			<section class="space-y-5">
				<div>
					<h3 class="text-base font-semibold">GitHub.com</h3>
					{#if app.githubAccounts.length === 0}
						<p class="mt-1 text-xs text-muted-foreground">
							Sign in to review pull requests and post comments.
						</p>
					{:else}
						<p class="mt-1 text-xs text-muted-foreground">
							The default account is used by any project that hasn't picked its own. Choose a
							project's account from the switcher in the top bar or next to the commit box.
						</p>
					{/if}
					{#if app.githubAccounts.length === 0}
						<Button size="sm" class="mt-3" onclick={startAddAccount}>
							<Plus class="size-3.5" /> Sign in to GitHub
						</Button>
					{:else}
						<ul class="mt-3 space-y-2">
							{#each app.githubAccounts as acct (acct.id)}
								{@const isDefault = acct.id === app.activeGithubAccount?.id}
								<li
									class="flex items-center gap-3 rounded-md border border-border bg-card/40 px-3 py-2"
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
								</li>
							{/each}
						</ul>
						<Button variant="outline" size="sm" class="mt-3" onclick={startAddAccount}>
							<Plus class="size-3.5" /> Add another account
						</Button>
					{/if}
				</div>
			</section>
		{:else if activeTab === 'appearance'}
			<section class="space-y-6">
				<div>
					<h3 class="text-base font-semibold">Theme</h3>
					<p class="mt-1 text-xs text-muted-foreground">Choose a light or dark appearance.</p>

					<div class="mt-4 grid grid-cols-2 gap-3">
						{#each [{ value: 'light' as const, label: 'Light' }, { value: 'dark' as const, label: 'Dark' }] as opt (opt.value)}
							{@const active = draftTheme === opt.value}
							<SettingOptionCard
								selected={active}
								label={opt.label}
								onclick={() => (draftTheme = opt.value)}
							>
								<div class="w-full p-2">
									<ThemePreview theme={opt.value} />
								</div>
							</SettingOptionCard>
						{/each}
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Accent</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						Color for primary buttons, highlights, links, and focus rings.
					</p>

					<div class="mt-4 grid grid-cols-2 gap-3">
						{#each ACCENTS as opt (opt.id)}
							{@const active = draftAccent === opt.id}
							<SettingOptionCard
								selected={active}
								label={opt.label}
								onclick={() => (draftAccent = opt.id)}
							>
								<div class="flex w-full items-center justify-center p-3">
									<span
										class="inline-flex h-7 items-center rounded-md px-4 text-xs font-semibold"
										style="background: {opt.primary}; color: {opt.fg};"
									>
										Publish
									</span>
								</div>
							</SettingOptionCard>
						{/each}
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">UI font</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						Font used for the sidebar, lists, and app chrome.
					</p>

					<div class="mt-3">
						<FontPicker value={draftUiFont} onChange={(f) => (draftUiFont = f)} />
					</div>
					<div
						class="mt-3 overflow-hidden rounded-lg border border-border bg-background py-1"
						style="font-family: {uiFontCss(draftUiFont)}"
					>
						<FileListPreview layout="tree" showIcons={draftShowFileIcons} />
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Code font</h3>
					<p class="mt-1 text-xs text-muted-foreground">Font used for diffs and code.</p>

					<div class="mt-3">
						<FontPicker value={draftCodeFont} mono onChange={(f) => (draftCodeFont = f)} />
					</div>
					<div
						class="mt-3 overflow-hidden rounded-lg border border-border bg-background p-1.5"
						style="--code-font: {codeFontCss(draftCodeFont)}"
					>
						<DiffStylePreview mode={draftViewMode} theme={draftDiffThemePair} />
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Diff view</h3>
					<p class="mt-1 text-xs text-muted-foreground">Choose how changes are displayed.</p>

					<div class="mt-4 grid grid-cols-2 gap-3">
						{#each [{ mode: 'split' as ViewMode, label: 'Split' }, { mode: 'unified' as ViewMode, label: 'Unified' }] as opt (opt.mode)}
							{@const active = draftViewMode === opt.mode}
							<SettingOptionCard
								selected={active}
								label={opt.label}
								onclick={() => (draftViewMode = opt.mode)}
							>
								<div class="w-full bg-background p-1.5">
									<DiffStylePreview mode={opt.mode} theme={draftDiffThemePair} />
								</div>
							</SettingOptionCard>
						{/each}
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Diff theme</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						Syntax highlighting theme for diff code blocks. Each theme has a light and dark variant
						that follows your appearance.
					</p>

					<div class="mt-3">
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class={cn(
									buttonVariants({ variant: 'outline', size: 'sm' }),
									'w-full justify-between font-normal'
								)}
							>
								<span class="truncate">{draftDiffThemeLabel}</span>
								<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="max-h-[260px]">
								{#each DIFF_THEMES as opt (opt.id)}
									<DropdownMenu.Item class="gap-2" onSelect={() => (draftDiffTheme = opt.id)}>
										<Check
											class={cn(
												'size-3.5',
												draftDiffTheme === opt.id ? 'opacity-100' : 'opacity-0'
											)}
										/>
										<span class="flex-1 truncate">{opt.label}</span>
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>

					<div class="mt-3 overflow-hidden rounded-lg border border-border bg-background p-1.5">
						<DiffStylePreview mode={draftViewMode} theme={draftDiffThemePair} />
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Diff layout</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						Choose whether all changed files render in one scrollable list or one file's diff shows
						at a time, switching as you pick files in the sidebar.
					</p>

					<div class="mt-4 grid grid-cols-2 gap-3">
						{#each [{ value: 'scroll' as DiffLayout, label: 'Scrollable', hint: 'All file diffs stack in one continuous scroll.' }, { value: 'single' as DiffLayout, label: 'One at a time', hint: 'Shows the selected file only, like GitHub Desktop.' }] as opt (opt.value)}
							{@const active = draftDiffLayout === opt.value}
							<SettingOptionCard
								selected={active}
								label={opt.label}
								hint={opt.hint}
								onclick={() => (draftDiffLayout = opt.value)}
							/>
						{/each}
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">File icons</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						Show language-specific icons next to file names in the sidebar.
					</p>

					<div class="mt-4 grid grid-cols-2 gap-3">
						{#each [{ value: true, label: 'Shown' }, { value: false, label: 'Hidden' }] as opt (opt.label)}
							{@const active = draftShowFileIcons === opt.value}
							<SettingOptionCard
								selected={active}
								label={opt.label}
								onclick={() => (draftShowFileIcons = opt.value)}
							>
								<div class="w-full bg-background py-1">
									<FileListPreview layout="tree" showIcons={opt.value} />
								</div>
							</SettingOptionCard>
						{/each}
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Animations</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						How much motion the UI uses. "Accents only" keeps hover/focus transitions and small
						flourishes but opens menus and dialogs instantly; "All" animates those overlays too.
					</p>

					<div class="mt-4 grid grid-cols-3 gap-3">
						{#each [{ value: 'none', label: 'None', hint: 'No motion anywhere; everything appears instantly.' }, { value: 'accents', label: 'Accents only', hint: 'Hover/focus transitions and flourishes; menus open instantly.' }, { value: 'all', label: 'All', hint: 'Everything, including menus, dialogs, and tooltips.' }] as const as opt (opt.value)}
							{@const active = draftAnimations === opt.value}
							<SettingOptionCard
								selected={active}
								label={opt.label}
								hint={opt.hint}
								onclick={() => (draftAnimations = opt.value)}
							/>
						{/each}
					</div>
				</div>
			</section>
		{:else if activeTab === 'behavior'}
			<section class="space-y-6">
				<div>
					<h3 class="text-base font-semibold">Arrow-key navigation</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						Choose what happens when you move the keyboard cursor onto a file with the arrow keys in
						the sidebar.
					</p>

					<div class="mt-4 grid grid-cols-2 gap-3">
						{#each [{ value: true, label: 'Open on arrow', hint: 'Arrowing onto a file opens its diff immediately.' }, { value: false, label: 'Open on enter', hint: 'Arrows move the cursor only; Enter opens the file.' }] as opt (opt.label)}
							{@const active = draftOpenFileOnArrowNav === opt.value}
							<SettingOptionCard
								selected={active}
								label={opt.label}
								hint={opt.hint}
								onclick={() => (draftOpenFileOnArrowNav = opt.value)}
							/>
						{/each}
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Merged branches</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						What to do when a checked-out branch's PR is merged.
					</p>

					<div class="mt-4 grid grid-cols-3 gap-3">
						{#each [{ value: 'prompt', label: 'Ask each time', hint: 'Show a dialog when a PR merges.' }, { value: 'switch', label: 'Switch back', hint: 'Switch to the default branch automatically.' }, { value: 'nothing', label: 'Do nothing', hint: 'Stay on the branch; never ask.' }] as opt (opt.value)}
							{@const active = draftPrMergedBehavior === opt.value}
							<SettingOptionCard
								selected={active}
								label={opt.label}
								hint={opt.hint}
								onclick={() => (draftPrMergedBehavior = opt.value as PrMergedBehavior)}
							/>
						{/each}
					</div>

					<div class="mt-3">
						<div class="flex items-start gap-2.5">
							<Checkbox
								id="auto-remove-merged"
								bind:checked={draftAutoRemoveMergedBranch}
								class="mt-0.5"
							/>
							<label for="auto-remove-merged" class="grid cursor-pointer gap-0.5 leading-snug">
								<span class="text-sm font-medium">Automatically remove merged branches locally</span
								>
								<span class="text-xs text-muted-foreground">
									After switching back, delete the merged branch from your machine without asking.
									The remote is never touched.
								</span>
							</label>
						</div>
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Reviewing</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						How the review view tracks which files you've already looked at.
					</p>

					<div class="mt-3">
						<div class="flex items-start gap-2.5">
							<Checkbox
								id="unmark-seen-on-change"
								bind:checked={draftUnmarkSeenOnChange}
								class="mt-0.5"
							/>
							<label for="unmark-seen-on-change" class="grid cursor-pointer gap-0.5 leading-snug">
								<span class="text-sm font-medium">Unmark seen files when they change</span>
								<span class="text-xs text-muted-foreground">
									When a file you marked as seen picks up new changes, fresh commits pushed to the
									branch, or further edits, clear its seen mark so it resurfaces for review.
								</span>
							</label>
						</div>
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Commits</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						How commits you make in Super Review are signed.
					</p>

					<div class="mt-3">
						<div class="flex items-start gap-2.5">
							<Checkbox id="sign-commits" bind:checked={draftSignCommits} class="mt-0.5" />
							<label for="sign-commits" class="grid cursor-pointer gap-0.5 leading-snug">
								<span class="text-sm font-medium">Sign my commits</span>
								<span class="text-xs text-muted-foreground">
									Super Review creates an SSH signing key for your GitHub account and registers it
									so your commits show as "Verified". No setup needed. Turn off to commit unsigned.
								</span>
							</label>
						</div>
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Recent repositories</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						How many recently opened repositories the repository picker lists in its "Recent"
						section. Set to 0 to hide the section.
					</p>

					<div class="mt-4 flex items-center gap-2">
						<Input type="number" min="0" step="1" bind:value={draftRecentRepoCount} class="w-32" />
						<span class="text-xs text-muted-foreground">repositories</span>
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Large diffs</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						Diffs with more changed lines than this are hidden behind a "Load diff" button by
						default. Set to 0 to disable the size limit.
					</p>

					<div class="mt-4 flex items-center gap-2">
						<Input type="number" min="0" step="100" bind:value={draftMaxDiffLines} class="w-32" />
						<span class="text-xs text-muted-foreground">changed lines</span>
					</div>
				</div>

				<div id="settings-hidden-files" class="scroll-mt-4">
					<div class="flex items-center justify-between gap-2">
						<h3 class="text-base font-semibold">Hidden files</h3>
						{#if !arraysEqual([...draftHiddenDiffPatterns].sort(), [...DEFAULT_HIDDEN_DIFF_PATTERNS].sort())}
							<Button variant="ghost" size="sm" onclick={resetPatterns}>
								<RotateCcw class="size-3.5" /> Reset to defaults
							</Button>
						{/if}
					</div>
					<p class="mt-1 text-xs text-muted-foreground">
						Files matching these glob patterns have their diffs hidden behind a "Load diff" button
						by default, such as lock files and build outputs. A pattern with no slash matches the
						file name anywhere (e.g. <code>*.lock</code>); one with a slash matches the full path
						(e.g.
						<code>dist/**</code>).
					</p>

					<div class="mt-3 flex gap-2">
						<Input
							placeholder="e.g. *.min.js or dist/**"
							bind:value={newPattern}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addPattern();
								}
							}}
							class="flex-1"
						/>
						<Button variant="outline" onclick={addPattern}>
							<Plus class="size-3.5" /> Add
						</Button>
					</div>

					{#if draftHiddenDiffPatterns.length === 0}
						<p class="mt-3 text-xs text-muted-foreground">
							No patterns. Every file's diff renders inline.
						</p>
					{:else}
						<div
							class="mt-3 overflow-hidden rounded-md border border-border [&_[data-slot=table-container]]:max-h-[250px]"
						>
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head class="sticky top-0 z-10 bg-background">Pattern</Table.Head>
										<Table.Head class="sticky top-0 z-10 w-12 bg-background"></Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each draftHiddenDiffPatterns as pattern (pattern)}
										<Table.Row>
											<Table.Cell class="font-mono text-xs">{pattern}</Table.Cell>
											<Table.Cell class="py-1 text-right">
												<button
													type="button"
													class="ml-auto inline-grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
													title={`Remove ${pattern}`}
													onclick={() => removePattern(pattern)}
												>
													<X class="size-3.5" />
												</button>
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
					{/if}
				</div>

				<div id="settings-custom-file-icons" class="scroll-mt-4">
					<h3 class="text-base font-semibold">Custom file icons</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						Give files matching a glob pattern your own icon. Patterns work like hidden files:
						<code>*.proto</code> matches the name anywhere, <code>infra/**</code> matches a path.
						The icon can be an <code>https://</code> URL or a local image path.
					</p>

					<div class="mt-3 flex gap-2">
						<Input placeholder="Pattern, e.g. *.proto" bind:value={newIconPattern} class="flex-1" />
						<Input
							placeholder="https://… or /path/to/icon.svg"
							bind:value={newIconSource}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addCustomIcon();
								}
							}}
							class="flex-1"
						/>
						<Button
							variant="outline"
							size="icon"
							onclick={pickIconFile}
							title="Choose a local image"
						>
							<FolderOpen class="size-3.5" />
						</Button>
						<Button variant="outline" onclick={addCustomIcon}>
							<Plus class="size-3.5" /> Add
						</Button>
					</div>

					{#if draftCustomFileIcons.length === 0}
						<p class="mt-3 text-xs text-muted-foreground">
							No custom icons. Files use their built-in language icons.
						</p>
					{:else}
						<div
							class="mt-3 overflow-hidden rounded-md border border-border [&_[data-slot=table-container]]:max-h-[250px]"
						>
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Head class="sticky top-0 z-10 w-10 bg-background"></Table.Head>
										<Table.Head class="sticky top-0 z-10 bg-background">Pattern</Table.Head>
										<Table.Head class="sticky top-0 z-10 bg-background">Icon</Table.Head>
										<Table.Head class="sticky top-0 z-10 w-12 bg-background"></Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each draftCustomFileIcons as icon (icon.pattern)}
										<Table.Row>
											<Table.Cell class="py-1">
												{#await resolveIconSrc(icon.source) then src}
													{#if src}
														<img {src} alt="" class="size-4 object-contain" />
													{:else}
														<span class="text-muted-foreground" title="Couldn't load this icon"
															>—</span
														>
													{/if}
												{/await}
											</Table.Cell>
											<Table.Cell class="font-mono text-xs">{icon.pattern}</Table.Cell>
											<Table.Cell
												class="max-w-[200px] truncate font-mono text-xs text-muted-foreground"
											>
												{icon.source}
											</Table.Cell>
											<Table.Cell class="py-1 text-right">
												<button
													type="button"
													class="ml-auto inline-grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
													title={`Remove ${icon.pattern}`}
													onclick={() => removeCustomIcon(icon.pattern)}
												>
													<X class="size-3.5" />
												</button>
											</Table.Cell>
										</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						</div>
					{/if}
				</div>
			</section>
		{:else if activeTab === 'app'}
			<section class="space-y-6">
				<div>
					<h3 class="text-base font-semibold">Window size</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						The size the window opens at, in pixels. Takes effect the next time the app launches.
						Values below the minimum ({WINDOW_BOUNDS.minWidth}×{WINDOW_BOUNDS.minHeight}) are raised
						to it.
					</p>

					<div class="mt-4 flex items-center gap-3">
						<div class="flex items-center gap-2">
							<Input
								id="window-width"
								type="number"
								min={WINDOW_BOUNDS.minWidth}
								step="10"
								bind:value={draftWindowWidth}
								disabled={draftStartMaximized}
								class="w-28"
							/>
							<label for="window-width" class="text-xs text-muted-foreground">width</label>
						</div>
						<span class="text-muted-foreground">×</span>
						<div class="flex items-center gap-2">
							<Input
								id="window-height"
								type="number"
								min={WINDOW_BOUNDS.minHeight}
								step="10"
								bind:value={draftWindowHeight}
								disabled={draftStartMaximized}
								class="w-28"
							/>
							<label for="window-height" class="text-xs text-muted-foreground">height</label>
						</div>
					</div>
					{#if draftStartMaximized}
						<p class="mt-2 text-xs text-muted-foreground">
							Used as the restored size when you un-maximize the window.
						</p>
					{/if}
				</div>

				<div class="flex items-start gap-2.5">
					<Checkbox id="start-maximized" bind:checked={draftStartMaximized} class="mt-0.5" />
					<label for="start-maximized" class="grid cursor-pointer gap-0.5 leading-snug">
						<span class="text-sm font-medium">Start maximized</span>
						<span class="text-xs text-muted-foreground">
							Open the window maximized to fill the screen. Takes effect on the next launch.
						</span>
					</label>
				</div>
			</section>
		{:else if activeTab === 'editor'}
			<section class="space-y-6">
				<div>
					<h3 class="text-base font-semibold">External editor</h3>
					<p class="mt-1 text-xs text-muted-foreground">Used by the "Open in editor" button.</p>

					<div class="mt-3 space-y-1.5">
						{#each sortedEditors as ed (ed)}
							{@const installed = app.editors[ed]}
							{@const selected = draftEditor === ed}
							<button
								type="button"
								disabled={!installed}
								class={cn(
									'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
									!installed
										? 'cursor-not-allowed border-border opacity-50'
										: selected
											? 'border-primary bg-primary/5'
											: 'border-border hover:bg-muted/40'
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
				</div>

				<div>
					<h3 class="text-base font-semibold">Terminal</h3>
					<p class="mt-1 text-xs text-muted-foreground">Used by the "Open in terminal" button.</p>

					<div class="mt-3 space-y-1.5">
						{#each sortedTerminals as t (t)}
							{@const installed = app.terminals[t]}
							{@const selected = draftTerminal === t}
							<button
								type="button"
								disabled={!installed}
								class={cn(
									'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors',
									!installed
										? 'cursor-not-allowed border-border opacity-50'
										: selected
											? 'border-primary bg-primary/5'
											: 'border-border hover:bg-muted/40'
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
				</div>

				<div>
					<h3 class="text-base font-semibold">Additional integrations</h3>
					<p class="mt-1 text-xs text-muted-foreground">Optional features for specific repos.</p>

					<div class="mt-3 flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
						<div
							class="grid size-10 shrink-0 place-items-center rounded-lg border border-border bg-card"
						>
							<ChangesetLogo class="h-5 w-auto" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">Changesets</div>
							<p class="text-xs text-muted-foreground">
								Prompts, commit message autofill, and a button to create one. For repos that use <a
									href="https://github.com/changesets/changesets"
									target="_blank"
									rel="noopener noreferrer"
									class="underline underline-offset-2 hover:text-foreground">changesets</a
								>.
							</p>
						</div>
						<Switch
							bind:checked={draftChangesetsEnabled}
							aria-label="Enable changesets integration"
						/>
					</div>
				</div>
			</section>
		{:else if activeTab === 'hotkeys'}
			<section class="space-y-6">
				<div>
					<div class="flex items-center justify-between gap-2">
						<h3 class="text-base font-semibold">Keyboard shortcuts</h3>
						{#if !hotkeysAreDefault}
							<Button variant="ghost" size="sm" onclick={resetHotkeys}>
								<RotateCcw class="size-3.5" /> Reset to defaults
							</Button>
						{/if}
					</div>
					<p class="mt-1 text-xs text-muted-foreground">
						Click a shortcut, then press the key combination you'd like to use. Press <kbd
							class="font-mono">Esc</kbd
						> to cancel.
					</p>

					<ul class="mt-4 space-y-2">
						{#each HOTKEY_ACTIONS as action (action)}
							{@const conflictWith = hotkeyConflict(action)}
							<li
								class="flex items-center gap-3 rounded-md border border-border bg-card/40 px-3 py-2"
							>
								<div class="min-w-0 flex-1">
									<div class="text-sm font-medium">
										{HOTKEY_LABELS[action].label}
									</div>
									<div class="text-xs text-muted-foreground">
										{#if conflictWith}
											<span class="text-destructive">
												Conflicts with “{HOTKEY_LABELS[conflictWith].label}”.
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
							</li>
						{/each}
					</ul>
				</div>
			</section>
		{/if}
	{/snippet}

	{#snippet footer()}
		<Button variant="secondary" size="sm" onclick={cancel}>Cancel</Button>
		<Button size="sm" onclick={save} disabled={hasHotkeyConflict}>Save</Button>
	{/snippet}
</SettingsShell>
