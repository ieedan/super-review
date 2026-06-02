<script lang="ts">
	import { tick } from 'svelte';
	import {
		AppWindow,
		Check,
		Code2,
		Keyboard,
		LogOut,
		Palette,
		Plus,
		RotateCcw,
		SlidersHorizontal,
		User,
		X
	} from 'lucide-svelte';
	import SettingsShell from './SettingsShell.svelte';
	import * as Avatar from './ui/avatar';
	import { Button } from './ui/button';
	import { Checkbox } from './ui/checkbox';
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
	import PowerShellIcon from './icons/PowerShellIcon.svelte';
	import ZshIcon from './icons/ZshIcon.svelte';
	import DiffStylePreview from './DiffStylePreview.svelte';
	import FileListPreview from './FileListPreview.svelte';
	import FontPicker from './FontPicker.svelte';
	import ThemePreview from './ThemePreview.svelte';
	import {
		actions,
		app,
		codeFontCss,
		effectiveEditor,
		effectiveTerminal,
		uiFontCss,
		type SettingsTab
	} from '$lib/store.svelte';
	import HotkeyInput from './HotkeyInput.svelte';
	import { DEFAULT_HIDDEN_DIFF_PATTERNS } from '@shared/diff-defer';
	import {
		DEFAULT_HOTKEYS,
		HOTKEY_ACTIONS,
		HOTKEY_LABELS,
		hotkeysEqual,
		type Hotkey,
		type HotkeyAction,
		type Hotkeys
	} from '@shared/hotkeys';
	import { EDITORS_BY_PLATFORM, TERMINALS_BY_PLATFORM, WINDOW_BOUNDS } from '@shared/types';
	import { cn } from '$lib/utils';
	import { ACCENTS } from '$lib/accents';
	import type {
		Accent,
		DiffLayout,
		EditorKind,
		PrMergedBehavior,
		TerminalKind,
		ViewMode
	} from '@shared/types';

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
	let draftAnimationsEnabled = $state<boolean>(false);
	let draftOpenFileOnArrowNav = $state<boolean>(true);
	let draftPrMergedBehavior = $state<PrMergedBehavior>('prompt');
	let draftAutoRemoveMergedBranch = $state<boolean>(false);
	let draftMaxDiffLines = $state<number>(1500);
	let draftWindowWidth = $state<number>(WINDOW_BOUNDS.defaultWidth);
	let draftWindowHeight = $state<number>(WINDOW_BOUNDS.defaultHeight);
	let draftStartMaximized = $state<boolean>(false);
	let draftHiddenDiffPatterns = $state<string[]>([]);
	let newPattern = $state<string>('');
	let draftTheme = $state<'light' | 'dark'>('dark');
	let draftAccent = $state<Accent>('super');
	let draftCodeFont = $state<string>('system');
	let draftUiFont = $state<string>('system');
	let draftEditor = $state<EditorKind | null>(null);
	let draftTerminal = $state<TerminalKind | null>(null);
	let draftHotkeys = $state<Hotkeys>({ ...DEFAULT_HOTKEYS });

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
			draftAnimationsEnabled = app.animationsEnabled;
			draftOpenFileOnArrowNav = app.openFileOnArrowNav;
			draftPrMergedBehavior = app.prMergedBehavior;
			draftAutoRemoveMergedBranch = app.autoRemoveMergedBranch;
			draftMaxDiffLines = app.maxDiffLines;
			draftWindowWidth = app.windowWidth;
			draftWindowHeight = app.windowHeight;
			draftStartMaximized = app.startMaximized;
			draftHiddenDiffPatterns = [...app.hiddenDiffPatterns];
			newPattern = '';
			draftTheme = app.theme;
			draftAccent = app.accent;
			draftCodeFont = app.codeFont;
			draftUiFont = app.uiFont;
			draftEditor = effectiveEditor();
			draftTerminal = effectiveTerminal();
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
		if (draftAnimationsEnabled !== app.animationsEnabled) {
			promises.push(actions.setAnimationsEnabled(draftAnimationsEnabled));
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
		const parsedMaxDiffLines = Number(draftMaxDiffLines);
		const clampedMaxDiffLines =
			Number.isFinite(parsedMaxDiffLines) && parsedMaxDiffLines >= 0
				? Math.floor(parsedMaxDiffLines)
				: 0;
		if (clampedMaxDiffLines !== app.maxDiffLines) {
			promises.push(actions.setMaxDiffLines(clampedMaxDiffLines));
		}
		if (!arraysEqual(draftHiddenDiffPatterns, app.hiddenDiffPatterns)) {
			promises.push(actions.setHiddenDiffPatterns(draftHiddenDiffPatterns));
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
							<button
								type="button"
								onclick={() => (draftTheme = opt.value)}
								class={cn(
									'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
									active ? 'border-primary' : 'border-border hover:border-muted-foreground/50'
								)}
							>
								<div
									class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
								>
									<span
										class={cn(
											'grid size-3.5 place-items-center rounded-full border',
											active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
										)}
									>
										{#if active}<Check class="size-2.5" />{/if}
									</span>
									{opt.label}
								</div>
								<div class="w-full p-2">
									<ThemePreview theme={opt.value} />
								</div>
							</button>
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
							<button
								type="button"
								onclick={() => (draftAccent = opt.id)}
								class={cn(
									'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
									active ? 'border-primary' : 'border-border hover:border-muted-foreground/50'
								)}
							>
								<div
									class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
								>
									<span
										class={cn(
											'grid size-3.5 place-items-center rounded-full border',
											active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
										)}
									>
										{#if active}<Check class="size-2.5" />{/if}
									</span>
									{opt.label}
								</div>
								<div class="flex w-full items-center justify-center p-3">
									<span
										class="inline-flex h-7 items-center rounded-md px-4 text-xs font-semibold"
										style="background: {opt.primary}; color: {opt.fg};"
									>
										Publish
									</span>
								</div>
							</button>
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
						<DiffStylePreview mode={draftViewMode} />
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Diff view</h3>
					<p class="mt-1 text-xs text-muted-foreground">Choose how changes are displayed.</p>

					<div class="mt-4 grid grid-cols-2 gap-3">
						{#each [{ mode: 'split' as ViewMode, label: 'Split' }, { mode: 'unified' as ViewMode, label: 'Unified' }] as opt (opt.mode)}
							{@const active = draftViewMode === opt.mode}
							<button
								type="button"
								onclick={() => (draftViewMode = opt.mode)}
								class={cn(
									'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
									active ? 'border-primary' : 'border-border hover:border-muted-foreground/50'
								)}
							>
								<div
									class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
								>
									<span
										class={cn(
											'grid size-3.5 place-items-center rounded-full border',
											active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
										)}
									>
										{#if active}<Check class="size-2.5" />{/if}
									</span>
									{opt.label}
								</div>
								<div class="w-full bg-background p-1.5">
									<DiffStylePreview mode={opt.mode} />
								</div>
							</button>
						{/each}
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
							<button
								type="button"
								onclick={() => (draftDiffLayout = opt.value)}
								class={cn(
									'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
									active ? 'border-primary' : 'border-border hover:border-muted-foreground/50'
								)}
							>
								<div
									class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
								>
									<span
										class={cn(
											'grid size-3.5 place-items-center rounded-full border',
											active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
										)}
									>
										{#if active}<Check class="size-2.5" />{/if}
									</span>
									{opt.label}
								</div>
								<div class="w-full bg-background px-3 py-2 text-xs text-muted-foreground">
									{opt.hint}
								</div>
							</button>
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
							<button
								type="button"
								onclick={() => (draftShowFileIcons = opt.value)}
								class={cn(
									'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
									active ? 'border-primary' : 'border-border hover:border-muted-foreground/50'
								)}
							>
								<div
									class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
								>
									<span
										class={cn(
											'grid size-3.5 place-items-center rounded-full border',
											active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
										)}
									>
										{#if active}<Check class="size-2.5" />{/if}
									</span>
									{opt.label}
								</div>
								<div class="w-full bg-background py-1">
									<FileListPreview layout="tree" showIcons={opt.value} />
								</div>
							</button>
						{/each}
					</div>
				</div>

				<div>
					<h3 class="text-base font-semibold">Animations</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						Enable enter/exit and hover transitions on menus, dialogs, tooltips, and other UI. Off
						by default for a snappier, motion-free feel.
					</p>

					<div class="mt-4 grid grid-cols-2 gap-3">
						{#each [{ value: false, label: 'Off', hint: 'UI appears instantly, with no motion.' }, { value: true, label: 'On', hint: 'Menus, dialogs, and tooltips animate in and out.' }] as opt (opt.label)}
							{@const active = draftAnimationsEnabled === opt.value}
							<button
								type="button"
								onclick={() => (draftAnimationsEnabled = opt.value)}
								class={cn(
									'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
									active ? 'border-primary' : 'border-border hover:border-muted-foreground/50'
								)}
							>
								<div
									class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
								>
									<span
										class={cn(
											'grid size-3.5 place-items-center rounded-full border',
											active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
										)}
									>
										{#if active}<Check class="size-2.5" />{/if}
									</span>
									{opt.label}
								</div>
								<div class="w-full bg-background px-3 py-2 text-xs text-muted-foreground">
									{opt.hint}
								</div>
							</button>
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
							<button
								type="button"
								onclick={() => (draftOpenFileOnArrowNav = opt.value)}
								class={cn(
									'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
									active ? 'border-primary' : 'border-border hover:border-muted-foreground/50'
								)}
							>
								<div
									class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
								>
									<span
										class={cn(
											'grid size-3.5 place-items-center rounded-full border',
											active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
										)}
									>
										{#if active}<Check class="size-2.5" />{/if}
									</span>
									{opt.label}
								</div>
								<div class="w-full bg-background px-3 py-2 text-xs text-muted-foreground">
									{opt.hint}
								</div>
							</button>
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
							<button
								type="button"
								onclick={() => (draftPrMergedBehavior = opt.value as PrMergedBehavior)}
								class={cn(
									'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
									active ? 'border-primary' : 'border-border hover:border-muted-foreground/50'
								)}
							>
								<div
									class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
								>
									<span
										class={cn(
											'grid size-3.5 shrink-0 place-items-center rounded-full border',
											active ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
										)}
									>
										{#if active}<Check class="size-2.5" />{/if}
									</span>
									{opt.label}
								</div>
								<div class="w-full bg-background px-3 py-2 text-xs text-muted-foreground">
									{opt.hint}
								</div>
							</button>
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
