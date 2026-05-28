<script lang="ts">
  import { Check, LogOut, Plus, Settings, User } from 'lucide-svelte';
  import { buttonVariants } from './ui/button';
  import * as DropdownMenu from './ui/dropdown-menu';
  import * as Avatar from './ui/avatar';
  import { actions, app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';

  function startSignIn(): void {
    actions.openGithubSignIn();
  }

  function openSettings(): void {
    actions.openSettingsDialog();
  }

  async function switchTo(id: string): Promise<void> {
    await actions.switchGithubAccount(id);
  }

  async function removeAccount(id: string): Promise<void> {
    await actions.removeGithubAccount(id);
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={cn(
      buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
      'rounded-full p-0',
    )}
    title={app.activeGithubAccount
      ? `Signed in as ${app.activeGithubAccount.login}`
      : 'Account'}
  >
    {#if app.activeGithubAccount}
      <Avatar.Root class="size-6">
        {#if app.activeGithubAccount.avatarUrl}
          <Avatar.Image
            src={app.activeGithubAccount.avatarUrl}
            alt={app.activeGithubAccount.login}
          />
        {/if}
        <Avatar.Fallback class="text-[10px]">
          {app.activeGithubAccount.login.slice(0, 2).toUpperCase()}
        </Avatar.Fallback>
      </Avatar.Root>
    {:else}
      <Avatar.Root class="size-6">
        <Avatar.Fallback>
          <User class="size-3.5" />
        </Avatar.Fallback>
      </Avatar.Root>
    {/if}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-[280px]">
    {#if app.githubAccounts.length > 0}
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading>Signed in accounts</DropdownMenu.GroupHeading>
        {#each app.githubAccounts as acct (acct.id)}
          {@const isActive = acct.id === app.activeGithubAccount?.id}
          <DropdownMenu.Item
            class={cn('gap-2', isActive && 'opacity-100')}
            disabled={isActive}
            closeOnSelect={!isActive}
            onSelect={() => switchTo(acct.id)}
          >
            <Avatar.Root class="size-6 shrink-0">
              {#if acct.avatarUrl}
                <Avatar.Image src={acct.avatarUrl} alt={acct.login} />
              {/if}
              <Avatar.Fallback class="text-[10px]">
                {acct.login.slice(0, 2).toUpperCase()}
              </Avatar.Fallback>
            </Avatar.Root>
            <div class="min-w-0 flex-1">
              <div class="truncate text-xs font-medium">{acct.login}</div>
              {#if acct.name}
                <div class="truncate text-[10px] text-muted-foreground">{acct.name}</div>
              {/if}
            </div>
            {#if isActive}
              <Check class="size-3.5 text-success" />
            {:else}
              <button
                type="button"
                class="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onclick={(e) => {
                  e.stopPropagation();
                  void removeAccount(acct.id);
                }}
                title={`Sign out ${acct.login}`}
                aria-label={`Sign out ${acct.login}`}
              >
                <LogOut class="size-3.5" />
              </button>
            {/if}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Group>
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Item onSelect={startSignIn}>
      <Plus class="size-3.5" />
      {app.githubAccounts.length > 0 ? 'Add another account' : 'Sign in to GitHub'}
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item onSelect={openSettings}>
      <Settings class="size-3.5" />
      Settings
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
