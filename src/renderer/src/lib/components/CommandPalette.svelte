<script lang="ts">
  import { Check } from 'lucide-svelte';
  import Icon from '@iconify/svelte/dist/OfflineIcon.svelte';
  import * as Command from './ui/command';
  import { actions, app } from '$lib/store.svelte';
  import { languageIconForPath } from '$lib/file-icons';
  import { truncatePathPrefix } from '$lib/path-truncate';
  import { cn } from '$lib/utils';

  // Free-text query bound to the command input. Reset whenever the palette
  // closes so a reopen always starts fresh.
  let search = $state('');

  $effect(() => {
    if (!app.commandMenuOpen) search = '';
  });

  // Global Cmd/Ctrl+P toggles the palette from anywhere in the app. We don't
  // skip editable targets here — unlike the sidebar's `/` shortcut, Cmd+P is a
  // deliberate modifier combo that shouldn't collide with normal typing.
  $effect(() => {
    function onKeydown(e: KeyboardEvent): void {
      if (e.key !== 'p' && e.key !== 'P') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      actions.toggleCommandMenu();
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  function choose(path: string): void {
    actions.scrollToFile(path);
    actions.closeCommandMenu();
  }

  // Split a path into the directory prefix and the filename (with its leading
  // slash folded in), mirroring the sidebar's list layout — the slash rides
  // with the name so the pretext-truncated prefix and name sit flush.
  function splitPath(path: string): { dir: string; name: string } {
    const slash = path.lastIndexOf('/');
    if (slash < 0) return { dir: '', name: path };
    return { dir: path.slice(0, slash), name: path.slice(slash) };
  }

  // The scrollable list element, measured to drive pretext path truncation.
  // Same approach as the sidebar: track the container width + the row font, and
  // pre-truncate the directory prefix in JS so we avoid per-frame CSS reflow.
  let listEl = $state<HTMLElement | null>(null);
  let listWidth = $state(0);
  let rowFont = $state('14px ui-sans-serif, system-ui, sans-serif');

  $effect(() => {
    if (!listEl) return;
    const el = listEl;
    listWidth = el.clientWidth;
    const cs = window.getComputedStyle(el);
    // Command items render at text-sm (14px); reuse the inherited family.
    rowFont = `${cs.fontWeight} 14px ${cs.fontFamily}`;
    const ro = new ResizeObserver(() => {
      listWidth = el.clientWidth;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  // Width left for the path text after fixed row chrome: group padding (px-2),
  // item padding (px-2), the seen checkbox (size-3.5), the flex gaps (gap-2),
  // and the optional language icon (size-4). `clientWidth` already excludes the
  // scrollbar, so a small margin is all that's reserved.
  const availablePathWidth = $derived.by(() => {
    const groupX = 16;
    const itemX = 16;
    const checkbox = 14;
    const margin = 8;
    const iconAndGap = app.showFileIcons ? 16 + 8 : 0;
    const gaps = app.showFileIcons ? 16 : 8;
    return Math.max(
      0,
      listWidth - groupX - itemX - checkbox - iconAndGap - gaps - margin,
    );
  });
</script>

<Command.Dialog
  bind:open={app.commandMenuOpen}
  title="Search files"
  description="Fuzzy search changed files by name"
  contentClass="sm:max-w-2xl"
>
  <Command.Input bind:value={search} placeholder="Search files…" />
  <Command.List bind:ref={listEl}>
    <Command.Empty>No files found.</Command.Empty>
    <Command.Group>
      {#each app.changedFiles as file (file.path)}
        {@const isSeen = app.seenFiles.has(file.path)}
        {@const iconName = languageIconForPath(file.path)}
        {@const parts = splitPath(file.path)}
        {@const displayPrefix = parts.dir
          ? truncatePathPrefix(parts.dir, parts.name, availablePathWidth, rowFont)
          : ''}
        <Command.Item
          value={file.path}
          onSelect={() => choose(file.path)}
          class="gap-2"
        >
          <!-- `!size-*` overrides command-dialog's global `[data-command-item]
               svg { h-5 w-5 }` rule, which would otherwise blow the check past
               the 14px circle and oversize the language icon. -->
          <span
            class={cn(
              'grid size-3.5 shrink-0 place-items-center rounded border',
              isSeen
                ? 'border-success bg-success text-success-foreground'
                : 'border-border',
            )}
            aria-label={isSeen ? 'Seen' : 'Unseen'}
          >
            {#if isSeen}
              <Check class="!size-2.5 text-white" />
            {/if}
          </span>
          {#if app.showFileIcons}
            <Icon icon={iconName} class="!size-4 shrink-0" />
          {/if}
          <!-- Inline whitespace is intentional: a newline between these flex
               children becomes a text node that can render as a visible gap.
               The prefix is pre-truncated to fit `availablePathWidth`. -->
          <span class={cn('flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap', isSeen && 'text-muted-foreground line-through')}>{#if displayPrefix}<span class="text-muted-foreground">{displayPrefix}</span>{/if}<span class="shrink-0">{parts.name}</span></span>
        </Command.Item>
      {/each}
    </Command.Group>
  </Command.List>
</Command.Dialog>
