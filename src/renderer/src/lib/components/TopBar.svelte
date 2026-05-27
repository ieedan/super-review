<script lang="ts">
  import RepoSwitcher from './RepoSwitcher.svelte';
  import ContextSwitcher from './ContextSwitcher.svelte';
  import GithubSignIn from './GithubSignIn.svelte';
  import { app } from '$lib/store.svelte';
</script>

<header
  class="flex h-11 items-center gap-2 border-b border-border bg-card/40 px-2 backdrop-blur"
  style="-webkit-app-region: drag"
>
  <div class="ml-12 flex items-center gap-1" style="-webkit-app-region: no-drag">
    <RepoSwitcher />
    {#if app.activeRepo}
      <span class="text-muted-foreground">/</span>
      <ContextSwitcher />
    {/if}
  </div>
  <div class="flex-1"></div>
  <div class="flex items-center gap-1" style="-webkit-app-region: no-drag">
    <GithubSignIn />
  </div>
</header>
