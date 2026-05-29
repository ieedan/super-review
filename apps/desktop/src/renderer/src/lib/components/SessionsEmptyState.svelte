<script lang="ts">
  import { app } from "$lib/store.svelte";
  import InstallSkillButton from "./InstallSkillButton.svelte";

  // Main-panel placeholder on the Sessions tab when no session is open.
  const hasSessions = $derived(app.sessions.length > 0);
</script>

<div class="grid h-full w-full place-items-center p-6">
  <div class="max-w-sm text-center">
    {#if hasSessions}
      <h2 class="text-lg font-semibold">Select a session</h2>
      <p class="mt-2 text-sm text-muted-foreground">
        Choose a session from the sidebar to review its changes.
      </p>
    {:else}
      <h2 class="text-lg font-semibold">No sessions yet</h2>
      {#if app.skillInstalled === false}
        <p class="mt-2 text-sm text-muted-foreground">
          Get started with sessions by installing the skill — it lets coding
          agents document their changes here for review.
        </p>
        <div class="mt-5 flex justify-center">
          <InstallSkillButton />
        </div>
      {:else}
        <p class="mt-2 text-sm text-muted-foreground">
          Sessions show up here once a coding agent documents its changes.
        </p>
      {/if}
    {/if}
  </div>
</div>
