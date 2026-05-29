<script lang="ts">
  import RepoSwitcher from './RepoSwitcher.svelte';
  import BranchPicker from './BranchPicker.svelte';
  import GithubSignIn from './GithubSignIn.svelte';
  import PrimaryActionButton from './PrimaryActionButton.svelte';
  import EditorButton from './EditorButton.svelte';
  import TerminalButton from './TerminalButton.svelte';
  import RefreshButton from './RefreshButton.svelte';
  import * as Sidebar from './ui/sidebar';
  import { Kbd } from './ui/kbd';
  import { Search } from 'lucide-svelte';
  import { actions, app } from '$lib/store.svelte';

  const isMac = $derived(app.platform === 'darwin');
</script>

<header
  class="relative z-30 flex h-11 items-center gap-2 border-b border-border bg-card/40 px-2 backdrop-blur"
  style="-webkit-app-region: drag"
>
  <!-- Pad past the macOS traffic-light buttons (titleBarStyle: hiddenInset). -->
  <div class="pl-20 flex items-center gap-1" style="-webkit-app-region: no-drag">
    {#if app.activeRepo}
      <Sidebar.Trigger class="size-6" />
    {/if}
    <RepoSwitcher />
    {#if app.activeRepo}
      <span class="text-muted-foreground">/</span>
      <BranchPicker />
    {/if}
  </div>
  <div class="flex-1"></div>

  {#if app.activeRepo}
    <!-- Centered fuzzy file-search trigger. Absolutely centered so it stays put
         regardless of the side groups' widths. -->
    <div
      class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style="-webkit-app-region: no-drag"
    >
      <button
        type="button"
        class="pointer-events-auto flex h-7 w-72 max-w-[40vw] items-center gap-2 rounded-md border border-input bg-background/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50"
        onclick={() => actions.openCommandMenu()}
        title="Search files"
      >
        <Search class="size-3.5 shrink-0" />
        <span class="flex-1 text-left">Search files…</span>
        <span class="flex shrink-0 items-center gap-1">
          <Kbd class="text-xs text-foreground/80">{isMac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd class="text-foreground/80">P</Kbd>
        </span>
      </button>
    </div>
  {/if}

  <div class="flex items-center gap-1" style="-webkit-app-region: no-drag">
    {#if app.activeRepo}
      <RefreshButton />
      <EditorButton />
      <TerminalButton />
      <PrimaryActionButton />
    {/if}
    <GithubSignIn />
  </div>
</header>
