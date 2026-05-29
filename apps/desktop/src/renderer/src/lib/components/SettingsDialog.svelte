<script lang="ts">
  import {
    Check,
    Code2,
    Keyboard,
    LogOut,
    Palette,
    Plus,
    RotateCcw,
    SlidersHorizontal,
    User,
    X,
  } from 'lucide-svelte';
  import * as Dialog from './ui/dialog';
  import * as Avatar from './ui/avatar';
  import { Button } from './ui/button';
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
    type Hotkeys,
  } from '@shared/hotkeys';
  import { EDITORS_BY_PLATFORM, TERMINALS_BY_PLATFORM } from '@shared/types';
  import { cn } from '$lib/utils';
  import type {
    EditorKind,
    FileListLayout,
    TerminalKind,
    ViewMode,
  } from '@shared/types';

  type SettingsTab =
    | 'accounts'
    | 'appearance'
    | 'behavior'
    | 'editor'
    | 'hotkeys';
  let activeTab = $state<SettingsTab>('accounts');

  const TABS: { id: SettingsTab; label: string; icon: typeof User }[] = [
    { id: 'accounts', label: 'Accounts', icon: User },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'behavior', label: 'Behavior', icon: SlidersHorizontal },
    { id: 'editor', label: 'Integrations', icon: Code2 },
    { id: 'hotkeys', label: 'Hotkeys', icon: Keyboard },
  ];

  const EDITOR_LABELS: Record<EditorKind, string> = {
    cursor: 'Cursor',
    vscode: 'Visual Studio Code',
    zed: 'Zed',
    xcode: 'Xcode',
    visualstudio: 'Visual Studio',
  };

  const TERMINAL_LABELS: Record<TerminalKind, string> = {
    terminal: 'Terminal',
    iterm: 'iTerm',
    warp: 'Warp',
    ghostty: 'Ghostty',
    cmd: 'Command Prompt',
    powershell: 'PowerShell',
  };

  // Only the editors/terminals that make sense on the current OS, with
  // installed options first and not-installed sunk to the bottom (stable).
  const sortedEditors = $derived(
    [...(EDITORS_BY_PLATFORM[app.platform] ?? [])].sort(
      (a, b) => Number(app.editors[b]) - Number(app.editors[a]),
    ),
  );
  const sortedTerminals = $derived(
    [...(TERMINALS_BY_PLATFORM[app.platform] ?? [])].sort(
      (a, b) => Number(app.terminals[b]) - Number(app.terminals[a]),
    ),
  );

  let dialogOpen = $derived(app.settingsDialogOpen);

  // Draft state — snapshot when the dialog opens, applied on Save.
  let draftViewMode = $state<ViewMode>('split');
  let draftFileListLayout = $state<FileListLayout>('tree');
  let draftShowFileIcons = $state<boolean>(true);
  let draftAnimationsEnabled = $state<boolean>(false);
  let draftOpenFileOnArrowNav = $state<boolean>(true);
  let draftMaxDiffLines = $state<number>(1500);
  let draftHiddenDiffPatterns = $state<string[]>([]);
  let newPattern = $state<string>('');
  let draftTheme = $state<'light' | 'dark'>('dark');
  let draftCodeFont = $state<string>('system');
  let draftUiFont = $state<string>('system');
  let draftEditor = $state<EditorKind | null>(null);
  let draftTerminal = $state<TerminalKind | null>(null);
  let draftHotkeys = $state<Hotkeys>({ ...DEFAULT_HOTKEYS });

  $effect(() => {
    if (dialogOpen) {
      draftViewMode = app.viewMode;
      draftFileListLayout = app.fileListLayout;
      draftShowFileIcons = app.showFileIcons;
      draftAnimationsEnabled = app.animationsEnabled;
      draftOpenFileOnArrowNav = app.openFileOnArrowNav;
      draftMaxDiffLines = app.maxDiffLines;
      draftHiddenDiffPatterns = [...app.hiddenDiffPatterns];
      newPattern = '';
      draftTheme = app.theme;
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

  const hasHotkeyConflict = $derived(
    HOTKEY_ACTIONS.some((a) => hotkeyConflict(a) !== null),
  );

  const hotkeysChanged = $derived(
    HOTKEY_ACTIONS.some((a) => !hotkeysEqual(draftHotkeys[a], app.hotkeys[a])),
  );

  const hotkeysAreDefault = $derived(
    HOTKEY_ACTIONS.every((a) => hotkeysEqual(draftHotkeys[a], DEFAULT_HOTKEYS[a])),
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

  async function save(): Promise<void> {
    const promises: Promise<unknown>[] = [];
    if (draftViewMode !== app.viewMode) {
      promises.push(actions.setViewMode(draftViewMode));
    }
    if (draftFileListLayout !== app.fileListLayout) {
      promises.push(actions.setFileListLayout(draftFileListLayout));
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
    if (draftTheme !== app.theme) {
      promises.push(actions.setTheme(draftTheme));
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

<Dialog.Root bind:open={dialogOpen} onOpenChange={(o) => !o && cancel()}>
  <Dialog.Content
    class="w-[720px] !max-w-[calc(100%-2rem)] !p-0 !gap-0 overflow-hidden"
    showCloseButton={true}
  >
    <Dialog.Header class="border-b border-border px-4 py-3">
      <Dialog.Title class="text-base">Settings</Dialog.Title>
    </Dialog.Header>

    <div class="flex h-[480px] min-h-0">
      <!-- Left nav -->
      <nav class="w-48 shrink-0 border-r border-border bg-card/30 p-2">
        {#each TABS as tab (tab.id)}
          {@const Icon = tab.icon}
          <button
            type="button"
            class={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
              activeTab === tab.id
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
            )}
            onclick={() => (activeTab = tab.id)}
          >
            <Icon class="size-4" />
            {tab.label}
          </button>
        {/each}
      </nav>

      <!-- Content panel -->
      <div class="min-w-0 flex-1 overflow-y-auto p-5">
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
                  The default account is used by any project that hasn't picked
                  its own. Choose a project's account from the switcher in the
                  top bar or next to the commit box.
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onclick={() => setDefaultAccount(acct.id)}
                        >
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
                <Button
                  variant="outline"
                  size="sm"
                  class="mt-3"
                  onclick={startAddAccount}
                >
                  <Plus class="size-3.5" /> Add another account
                </Button>
              {/if}
            </div>
          </section>
        {:else if activeTab === 'appearance'}
          <section class="space-y-6">
            <div>
              <h3 class="text-base font-semibold">Theme</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                Choose a light or dark appearance.
              </p>

              <div class="mt-4 grid grid-cols-2 gap-3">
                {#each [{ value: 'light' as const, label: 'Light' }, { value: 'dark' as const, label: 'Dark' }] as opt (opt.value)}
                  {@const active = draftTheme === opt.value}
                  <button
                    type="button"
                    onclick={() => (draftTheme = opt.value)}
                    class={cn(
                      'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
                      active
                        ? 'border-primary'
                        : 'border-border hover:border-muted-foreground/50',
                    )}
                  >
                    <div
                      class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
                    >
                      <span
                        class={cn(
                          'grid size-3.5 place-items-center rounded-full border',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border',
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
              <h3 class="text-base font-semibold">UI font</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                Font used for the sidebar, lists, and app chrome.
              </p>

              <div class="mt-3">
                <FontPicker
                  value={draftUiFont}
                  onChange={(f) => (draftUiFont = f)}
                />
              </div>
              <div
                class="mt-3 overflow-hidden rounded-lg border border-border bg-background py-1"
                style="font-family: {uiFontCss(draftUiFont)}"
              >
                <FileListPreview layout={draftFileListLayout} showIcons={draftShowFileIcons} />
              </div>
            </div>

            <div>
              <h3 class="text-base font-semibold">Code font</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                Font used for diffs and code.
              </p>

              <div class="mt-3">
                <FontPicker
                  value={draftCodeFont}
                  mono
                  onChange={(f) => (draftCodeFont = f)}
                />
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
              <p class="mt-1 text-xs text-muted-foreground">
                Choose how changes are displayed.
              </p>

              <div class="mt-4 grid grid-cols-2 gap-3">
                {#each [{ mode: 'split' as ViewMode, label: 'Split' }, { mode: 'unified' as ViewMode, label: 'Unified' }] as opt (opt.mode)}
                  {@const active = draftViewMode === opt.mode}
                  <button
                    type="button"
                    onclick={() => (draftViewMode = opt.mode)}
                    class={cn(
                      'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
                      active
                        ? 'border-primary'
                        : 'border-border hover:border-muted-foreground/50',
                    )}
                  >
                    <div
                      class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
                    >
                      <span
                        class={cn(
                          'grid size-3.5 place-items-center rounded-full border',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border',
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
              <h3 class="text-base font-semibold">File list</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                Choose how changed files are organized in the sidebar.
              </p>

              <div class="mt-4 grid grid-cols-2 gap-3">
                {#each [{ layout: 'tree' as FileListLayout, label: 'Tree' }, { layout: 'list' as FileListLayout, label: 'List' }] as opt (opt.layout)}
                  {@const active = draftFileListLayout === opt.layout}
                  <button
                    type="button"
                    onclick={() => (draftFileListLayout = opt.layout)}
                    class={cn(
                      'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
                      active
                        ? 'border-primary'
                        : 'border-border hover:border-muted-foreground/50',
                    )}
                  >
                    <div
                      class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
                    >
                      <span
                        class={cn(
                          'grid size-3.5 place-items-center rounded-full border',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border',
                        )}
                      >
                        {#if active}<Check class="size-2.5" />{/if}
                      </span>
                      {opt.label}
                    </div>
                    <div class="w-full bg-background py-1">
                      <FileListPreview layout={opt.layout} showIcons={draftShowFileIcons} />
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
                      active
                        ? 'border-primary'
                        : 'border-border hover:border-muted-foreground/50',
                    )}
                  >
                    <div
                      class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
                    >
                      <span
                        class={cn(
                          'grid size-3.5 place-items-center rounded-full border',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border',
                        )}
                      >
                        {#if active}<Check class="size-2.5" />{/if}
                      </span>
                      {opt.label}
                    </div>
                    <div class="w-full bg-background py-1">
                      <FileListPreview layout={draftFileListLayout} showIcons={opt.value} />
                    </div>
                  </button>
                {/each}
              </div>
            </div>

            <div>
              <h3 class="text-base font-semibold">Animations</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                Enable enter/exit and hover transitions on menus, dialogs,
                tooltips, and other UI. Off by default for a snappier,
                motion-free feel.
              </p>

              <div class="mt-4 grid grid-cols-2 gap-3">
                {#each [{ value: false, label: 'Off', hint: 'UI appears instantly, with no motion.' }, { value: true, label: 'On', hint: 'Menus, dialogs, and tooltips animate in and out.' }] as opt (opt.label)}
                  {@const active = draftAnimationsEnabled === opt.value}
                  <button
                    type="button"
                    onclick={() => (draftAnimationsEnabled = opt.value)}
                    class={cn(
                      'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
                      active
                        ? 'border-primary'
                        : 'border-border hover:border-muted-foreground/50',
                    )}
                  >
                    <div
                      class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
                    >
                      <span
                        class={cn(
                          'grid size-3.5 place-items-center rounded-full border',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border',
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
                Choose what happens when you move the keyboard cursor onto a file
                with the arrow keys in the sidebar.
              </p>

              <div class="mt-4 grid grid-cols-2 gap-3">
                {#each [{ value: true, label: 'Open on arrow', hint: 'Arrowing onto a file opens its diff immediately.' }, { value: false, label: 'Open on enter', hint: 'Arrows move the cursor only; Enter opens the file.' }] as opt (opt.label)}
                  {@const active = draftOpenFileOnArrowNav === opt.value}
                  <button
                    type="button"
                    onclick={() => (draftOpenFileOnArrowNav = opt.value)}
                    class={cn(
                      'flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
                      active
                        ? 'border-primary'
                        : 'border-border hover:border-muted-foreground/50',
                    )}
                  >
                    <div
                      class="flex w-full items-center gap-2 border-b border-border bg-card/40 px-3 py-2 text-xs font-medium"
                    >
                      <span
                        class={cn(
                          'grid size-3.5 place-items-center rounded-full border',
                          active
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border',
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
              <h3 class="text-base font-semibold">Large diffs</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                Diffs with more changed lines than this are hidden behind a
                "Load diff" button by default. Set to 0 to disable the size
                limit.
              </p>

              <div class="mt-4 flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="100"
                  bind:value={draftMaxDiffLines}
                  class="w-32"
                />
                <span class="text-xs text-muted-foreground">changed lines</span>
              </div>
            </div>

            <div>
              <div class="flex items-center justify-between gap-2">
                <h3 class="text-base font-semibold">Hidden files</h3>
                {#if !arraysEqual([...draftHiddenDiffPatterns].sort(), [...DEFAULT_HIDDEN_DIFF_PATTERNS].sort())}
                  <Button variant="ghost" size="sm" onclick={resetPatterns}>
                    <RotateCcw class="size-3.5" /> Reset to defaults
                  </Button>
                {/if}
              </div>
              <p class="mt-1 text-xs text-muted-foreground">
                Files matching these glob patterns have their diffs hidden
                behind a "Load diff" button by default — lock files, build
                outputs, etc. A pattern with no slash matches the file name
                anywhere (e.g. <code>*.lock</code>); one with a slash matches the
                full path (e.g. <code>dist/**</code>).
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
                  No patterns — every file's diff renders inline.
                </p>
              {:else}
                <div
                  class="mt-3 overflow-hidden rounded-md border border-border [&_[data-slot=table-container]]:max-h-[250px]"
                >
                  <Table.Root>
                    <Table.Header>
                      <Table.Row>
                        <Table.Head class="sticky top-0 z-10 bg-background">
                          Pattern
                        </Table.Head>
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
        {:else if activeTab === 'editor'}
          <section class="space-y-6">
            <div>
              <h3 class="text-base font-semibold">External editor</h3>
              <p class="mt-1 text-xs text-muted-foreground">
                Used by the "Open in editor" button.
              </p>

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
                          : 'border-border hover:bg-muted/40',
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
              <p class="mt-1 text-xs text-muted-foreground">
                Used by the "Open in terminal" button.
              </p>

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
                          : 'border-border hover:bg-muted/40',
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
                Click a shortcut, then press the key combination you'd like to
                use. Press <kbd class="font-mono">Esc</kbd> to cancel.
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
      </div>
    </div>

    <footer
      class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3"
    >
      <Button variant="secondary" size="sm" onclick={cancel}>Cancel</Button>
      <Button size="sm" onclick={save} disabled={hasHotkeyConflict}>Save</Button>
    </footer>
  </Dialog.Content>
</Dialog.Root>
