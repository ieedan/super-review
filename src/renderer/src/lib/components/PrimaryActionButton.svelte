<script lang="ts">
  import {
    ArrowUp,
    ArrowUpFromLine,
    ExternalLink,
    GitPullRequest,
    GitPullRequestArrow,
    Loader2,
  } from 'lucide-svelte';
  import { Button } from './ui/button';
  import { actions, app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';

  let status = $derived(app.pushStatus);
  let busy = $derived(app.push.inProgress);
  let stage = $derived(app.push.stage);

  type Mode = 'push' | 'go-pr' | 'create-pr' | 'none';

  // Branch has commits the default branch doesn't — i.e. there's content to
  // open a PR for. 0 when on the default branch or when the branch hasn't
  // diverged from it.
  let branchHasChanges = $derived((status?.aheadOfDefault ?? 0) > 0);

  let mode = $derived.by<Mode>(() => {
    if (status?.hasRemote && (status.ahead > 0 || !status.hasUpstream)) return 'push';
    if (app.branchPR) return 'go-pr';
    if (branchHasChanges) return 'create-pr';
    return 'none';
  });

  let label = $derived.by(() => {
    if (busy) {
      switch (stage) {
        case 'fetching':
          return 'Fetching…';
        case 'pulling':
          return 'Pulling…';
        case 'pushing':
          return 'Pushing…';
        default:
          return 'Working…';
      }
    }
    switch (mode) {
      case 'push':
        return status && status.ahead > 0 ? `Push ${status.ahead}` : 'Publish';
      case 'go-pr':
        return `PR #${app.branchPR?.number}`;
      case 'create-pr':
        return 'Create PR';
      case 'none':
        return '';
    }
  });

  let Icon = $derived.by(() => {
    if (busy) return Loader2;
    switch (mode) {
      case 'push':
        return status?.hasUpstream ? ArrowUp : ArrowUpFromLine;
      case 'go-pr':
        return ExternalLink;
      case 'create-pr':
        return GitPullRequest;
      case 'none':
        return GitPullRequest;
    }
  });

  let disabled = $derived.by(() => {
    if (busy) return true;
    if (mode === 'push') return !status?.hasRemote;
    // PR actions require a GitHub-linked repo.
    return !app.activeRepo?.githubOwner || !app.activeRepo?.githubRepo;
  });

  function click(): void {
    switch (mode) {
      case 'push':
        void actions.push();
        return;
      case 'go-pr':
      case 'create-pr':
        void actions.openPRPage();
        return;
    }
  }

  let title = $derived.by(() => {
    switch (mode) {
      case 'push':
        if (!status?.hasUpstream) return 'Publish branch to origin';
        return `Push ${status.ahead} commit${status.ahead === 1 ? '' : 's'} to origin`;
      case 'go-pr':
        return app.branchPR ? `Open PR #${app.branchPR.number}` : 'Open PR';
      case 'create-pr':
        return 'Open the create-pull-request page on GitHub';
      case 'none':
        return '';
    }
  });
</script>

{#if app.activeRepo && mode !== 'none'}
  <Button
    variant={mode === 'go-pr' ? 'secondary' : 'default'}
    size="sm"
    {disabled}
    onclick={click}
    {title}
  >
    <Icon class={cn('size-3.5', busy && 'animate-spin')} />
    <span class="text-xs">{label}</span>
    {#if mode === 'go-pr'}
      <GitPullRequestArrow class="size-3 text-muted-foreground" />
    {/if}
  </Button>
{/if}
