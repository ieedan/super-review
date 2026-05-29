<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Check, LogOut, Plus, RotateCcw, Settings } from 'lucide-svelte';
  import * as DropdownMenu from './ui/dropdown-menu';
  import * as Avatar from './ui/avatar';
  import { actions, app } from '$lib/store.svelte';
  import { cn } from '$lib/utils';

  let {
    trigger,
    triggerClass,
    triggerTitle,
    align = 'end',
    side = 'bottom',
    showSettings = true,
    heading = 'Signed in accounts',
    // Account currently in effect (gets the checkmark). Defaults to the
    // app-wide active account.
    selectedAccountId = app.activeGithubAccount?.id,
    // App-wide default — when provided, that account is tagged "default".
    defaultAccountId,
    // What happens when an account is chosen. Defaults to pinning the account
    // to the current project.
    onSelectAccount = (id: string) => void actions.setRepoGithubAccount(id),
    // When provided, a "Use app default" item appears that unpins the project.
    onUseDefault,
    // Whether the project currently has its own pinned account (controls
    // whether the reset item is shown).
    isPinned = false,
  }: {
    trigger: Snippet;
    triggerClass?: string;
    triggerTitle?: string;
    align?: 'start' | 'center' | 'end';
    side?: 'top' | 'right' | 'bottom' | 'left';
    showSettings?: boolean;
    heading?: string;
    selectedAccountId?: string;
    defaultAccountId?: string;
    onSelectAccount?: (id: string) => void;
    onUseDefault?: () => void;
    isPinned?: boolean;
  } = $props();

  function startSignIn(): void {
    actions.openGithubSignIn();
  }

  function openSettings(): void {
    actions.openSettingsDialog();
  }

  async function removeAccount(id: string): Promise<void> {
    await actions.removeGithubAccount(id);
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class={triggerClass} title={triggerTitle}>
    {@render trigger()}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content {align} {side} class="min-w-[280px]">
    {#if app.githubAccounts.length > 0}
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading>{heading}</DropdownMenu.GroupHeading>
        {#each app.githubAccounts as acct (acct.id)}
          {@const isSelected = acct.id === selectedAccountId}
          <DropdownMenu.Item
            class={cn('gap-2', isSelected && 'opacity-100')}
            disabled={isSelected}
            closeOnSelect={!isSelected}
            onSelect={() => onSelectAccount(acct.id)}
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
              <div class="flex items-center gap-1.5">
                <span class="truncate text-xs font-medium">{acct.login}</span>
                {#if defaultAccountId && acct.id === defaultAccountId}
                  <span
                    class="shrink-0 rounded-sm bg-muted px-1 text-[9px] uppercase tracking-wide text-muted-foreground"
                  >
                    default
                  </span>
                {/if}
              </div>
              {#if acct.name}
                <div class="truncate text-[10px] text-muted-foreground">{acct.name}</div>
              {/if}
            </div>
            {#if isSelected}
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
      {#if onUseDefault && isPinned}
        <DropdownMenu.Item onSelect={() => onUseDefault?.()}>
          <RotateCcw class="size-3.5" />
          Use app default
        </DropdownMenu.Item>
      {/if}
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Item onSelect={startSignIn}>
      <Plus class="size-3.5" />
      {app.githubAccounts.length > 0 ? 'Add another account' : 'Sign in to GitHub'}
    </DropdownMenu.Item>
    {#if showSettings}
      <DropdownMenu.Separator />
      <DropdownMenu.Item onSelect={openSettings}>
        <Settings class="size-3.5" />
        Settings
      </DropdownMenu.Item>
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
