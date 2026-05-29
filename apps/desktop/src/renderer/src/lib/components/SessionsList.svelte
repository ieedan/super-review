<script lang="ts">
  import { ExternalLink, Trash2 } from "lucide-svelte";
  import { actions, app } from "$lib/store.svelte";
  import { formatRelative } from "$lib/utils";
  import { harnessLabel } from "$lib/harness-logos";
  import HarnessLogo from "./HarnessLogo.svelte";

  // Re-reading nowTick keeps the relative timestamps ticking with the app's
  // shared interval, same as elsewhere in the UI.
  const sessions = $derived(app.sessions);

  function openExternal(url: string, e: MouseEvent): void {
    e.stopPropagation();
    void window.api.shell.openExternal(url);
  }

  function remove(id: string, e: MouseEvent): void {
    e.stopPropagation();
    void actions.deleteSession(id);
  }

  function relative(updatedAt: number): string {
    void app.nowTick;
    return formatRelative(new Date(updatedAt).toISOString());
  }
</script>

<div class="h-full w-full overflow-y-auto">
  {#if sessions.length === 0}
    <div class="grid h-full w-full place-items-center p-6">
      <div class="max-w-md text-center">
        <h2 class="text-lg font-semibold">No sessions yet</h2>
        <p class="mt-2 text-sm text-muted-foreground">
          Sessions are agent-documented collections of changes. When a coding
          agent finishes, it records one with the super-review CLI:
        </p>
        <pre
          class="mt-3 overflow-x-auto rounded-md border border-border bg-muted/40 p-3 text-left text-xs"><code
            >super-review session save \
  --key "&lt;conversation id&gt;" \
  --name "What I did" \
  --description "Details" \
  --harness claude-code</code
          ></pre>
      </div>
    </div>
  {:else}
    <div class="mx-auto flex max-w-3xl flex-col gap-2 p-4">
      {#each sessions as session (session.id)}
        <div
          role="button"
          tabindex="0"
          class="group flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent"
          onclick={() => actions.openSession(session.id)}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void actions.openSession(session.id);
            }
          }}
        >
          <div
            class="mt-0.5 grid size-8 flex-none place-items-center rounded-md border border-border bg-card"
            title={harnessLabel(session.harness, session.harnessLabel)}
          >
            <HarnessLogo harness={session.harness} size={18} />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium">{session.name}</span>
              {#if session.harnessUrl}
                <button
                  type="button"
                  class="flex-none rounded p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                  title={`Open in ${harnessLabel(session.harness, session.harnessLabel)}`}
                  onclick={(e) => openExternal(session.harnessUrl!, e)}
                >
                  <ExternalLink class="size-3.5" />
                </button>
              {/if}
            </div>
            {#if session.description}
              <p class="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {session.description}
              </p>
            {/if}
            <div
              class="mt-1.5 flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground"
            >
              <span>{harnessLabel(session.harness, session.harnessLabel)}</span>
              <span>·</span>
              <span>{relative(session.updatedAt)}</span>
              <span>·</span>
              <span
                >{session.fileCount} file{session.fileCount === 1
                  ? ""
                  : "s"}</span
              >
              <span class="text-success">+{session.additions}</span>
              <span class="text-destructive">−{session.deletions}</span>
              {#if session.branch}
                <span>·</span>
                <span class="truncate">{session.branch}</span>
              {/if}
            </div>
          </div>
          <button
            type="button"
            class="flex-none rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            title="Delete session"
            onclick={(e) => remove(session.id, e)}
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>
