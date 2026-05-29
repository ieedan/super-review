<script lang="ts">
  import { User } from 'lucide-svelte';
  import { buttonVariants } from './ui/button';
  import * as Avatar from './ui/avatar';
  import AccountSwitcher from './AccountSwitcher.svelte';
  import { actions, app, effectiveGithubAccount } from '$lib/store.svelte';
  import { cn } from '$lib/utils';

  // Shows the account the current project authenticates as (its pin, else the
  // app-wide default) and switches the project's account — same behavior as the
  // commit-box switcher.
  const account = $derived(effectiveGithubAccount());
</script>

<AccountSwitcher
  align="end"
  heading="Account for this project"
  selectedAccountId={account?.id}
  defaultAccountId={app.activeGithubAccount?.id}
  isPinned={!!app.activeRepo?.githubAccountId}
  onSelectAccount={(id) => actions.setRepoGithubAccount(id)}
  onUseDefault={() => actions.setRepoGithubAccount(null)}
  triggerTitle={account
    ? `This project uses ${account.login} — click to switch`
    : 'Account'}
  triggerClass={cn(
    buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
    'rounded-full p-0',
  )}
>
  {#snippet trigger()}
    {#if account}
      <Avatar.Root class="size-6">
        {#if account.avatarUrl}
          <Avatar.Image src={account.avatarUrl} alt={account.login} />
        {/if}
        <Avatar.Fallback class="text-[10px]">
          {account.login.slice(0, 2).toUpperCase()}
        </Avatar.Fallback>
      </Avatar.Root>
    {:else}
      <Avatar.Root class="size-6">
        <Avatar.Fallback>
          <User class="size-3.5" />
        </Avatar.Fallback>
      </Avatar.Root>
    {/if}
  {/snippet}
</AccountSwitcher>
