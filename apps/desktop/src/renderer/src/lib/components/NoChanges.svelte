<script lang="ts">
  import { Code, FolderOpen, Github } from "lucide-svelte";
  import {
    actions,
    app,
    effectiveEditor,
    EDITOR_LABELS,
  } from "$lib/store.svelte";

  // Which repo-level actions can we actually offer? Each card only renders
  // when its action is meaningful — no editor configured, no GitHub remote,
  // etc. — so the empty state never dangles a button that does nothing.
  const editor = $derived(effectiveEditor());
  const hasRemote = $derived(
    !!(app.activeRepo?.githubOwner && app.activeRepo?.githubRepo),
  );

  // "Show in Finder" on macOS, but the OS file manager is named differently
  // elsewhere — mirror the label the file-row context menu uses.
  const revealLabel = $derived(
    app.platform === "win32"
      ? "Explorer"
      : app.platform === "linux"
        ? "File Manager"
        : "Finder",
  );
</script>

<div class="grid h-full w-full place-items-center">
  <div class="w-full max-w-md px-6">
    <h1 class="text-center text-2xl font-semibold">No local changes</h1>
    <p class="mt-2 text-center text-sm text-muted-foreground">
      There are no uncommitted changes in this repository. Here are some things
      you can do next.
    </p>
    <div class="mt-6 grid gap-3">
      {#if editor}
        <button
          type="button"
          class="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
          onclick={() => actions.openInEditor()}
        >
          <Code class="mt-0.5 size-5 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">
              Open in {EDITOR_LABELS[editor]}
            </div>
            <div class="text-xs text-muted-foreground">
              Open the repository in your external editor.
            </div>
          </div>
        </button>
      {/if}

      <button
        type="button"
        class="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
        onclick={() => actions.openRepoInFileManager()}
      >
        <FolderOpen class="mt-0.5 size-5 text-muted-foreground" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">Show in {revealLabel}</div>
          <div class="text-xs text-muted-foreground">
            View the repository's files in {revealLabel}.
          </div>
        </div>
      </button>

      {#if hasRemote}
        <button
          type="button"
          class="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
          onclick={() => actions.openRepoOnGithub()}
        >
          <Github class="mt-0.5 size-5 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">View on GitHub</div>
            <div class="text-xs text-muted-foreground">
              Open the repository page in your browser.
            </div>
          </div>
        </button>
      {/if}
    </div>
  </div>
</div>
