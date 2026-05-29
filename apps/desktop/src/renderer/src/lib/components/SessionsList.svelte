<script lang="ts">
  import { ExternalLink, MoreHorizontal, Trash2 } from "lucide-svelte";
  import { actions, app } from "$lib/store.svelte";
  import { formatRelative } from "$lib/utils";
  import { harnessLabel } from "$lib/harness-logos";
  import HarnessLogo from "./HarnessLogo.svelte";
  import * as DropdownMenu from "./ui/dropdown-menu";

  // Compact list of the active repo's documented sessions, shown in the sidebar
  // when the Sessions tab is active and no session is open. Selecting one opens
  // its frozen diff (which swaps this list for the session's file list).
  const sessions = $derived(app.sessions);

  function openExternal(url: string, e: MouseEvent): void {
    e.stopPropagation();
    void window.api.shell.openExternal(url);
  }

  function remove(id: string): void {
    void actions.deleteSession(id);
  }

  // Re-read nowTick so relative timestamps tick with the app's shared interval.
  function relative(updatedAt: number): string {
    void app.nowTick;
    return formatRelative(new Date(updatedAt).toISOString());
  }
</script>

{#if sessions.length === 0}
  <div class="px-3 py-8 text-center text-xs text-muted-foreground">
    No sessions yet
  </div>
{:else}
  <div class="flex flex-col gap-1 p-2">
    {#each sessions as session (session.id)}
      <div
        role="button"
        tabindex="0"
        class="group flex cursor-pointer items-start gap-2.5 rounded-md border border-transparent p-2 text-left transition-colors hover:bg-accent"
        onclick={() => actions.openSession(session.id)}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void actions.openSession(session.id);
          }
        }}
      >
        <div
          class="mt-0.5 grid size-6 flex-none place-items-center rounded-md border border-border bg-card"
          title={harnessLabel(session.harness, session.harnessLabel)}
        >
          <HarnessLogo harness={session.harness} size={14} />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="truncate text-xs font-medium">{session.name}</span>
            {#if session.harnessUrl}
              <button
                type="button"
                class="flex-none rounded p-0.5 text-muted-foreground opacity-0 hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
                title={`Open in ${harnessLabel(session.harness, session.harnessLabel)}`}
                onclick={(e) => openExternal(session.harnessUrl!, e)}
              >
                <ExternalLink class="size-3" />
              </button>
            {/if}
          </div>
          {#if session.description}
            <p class="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
              {session.description}
            </p>
          {/if}
          <div
            class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground"
          >
            <span>{relative(session.updatedAt)}</span>
            <span>·</span>
            <span
              >{session.fileCount} file{session.fileCount === 1 ? "" : "s"}</span
            >
            <span class="text-success">+{session.additions}</span>
            <span class="text-destructive">−{session.deletions}</span>
            {#if session.branch}
              <span>·</span>
              <span class="truncate">{session.branch}</span>
            {/if}
          </div>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class="grid size-6 flex-none place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label="Session actions"
            onclick={(e: MouseEvent) => e.stopPropagation()}
          >
            <MoreHorizontal class="size-3.5" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <DropdownMenu.Item
              variant="destructive"
              onSelect={() => remove(session.id)}
            >
              <Trash2 class="size-3.5" />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    {/each}
  </div>
{/if}
