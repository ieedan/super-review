<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { GithubAccount, GithubAuthError } from '@super-review/core/types';
	import Check from '@lucide/svelte/icons/check';
	import LogOut from '@lucide/svelte/icons/log-out';
	import Plus from '@lucide/svelte/icons/plus';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Settings from '@lucide/svelte/icons/settings';
	import * as DropdownMenu from './ui/dropdown-menu';
	import * as Avatar from './ui/avatar';
	import { cn } from './utils';

	// Decoupled from the global store: the account list, auth errors, and all
	// actions are passed in. The desktop app wires these to its store; other
	// hosts (e.g. the marketing site) can supply static data.
	let {
		accounts,
		authErrors = [],
		trigger,
		triggerClass,
		triggerTitle,
		align = 'end',
		side = 'bottom',
		showSettings = true,
		heading = 'Signed in accounts',
		// Account currently in effect (gets the checkmark).
		selectedAccountId,
		// App-wide default — when provided, that account is tagged "default".
		defaultAccountId,
		// What happens when an account is chosen.
		onSelectAccount,
		// When provided, a "Use app default" item appears that unpins the project.
		onUseDefault,
		// Whether the project currently has its own pinned account (controls
		// whether the reset item is shown).
		isPinned = false,
		// Add-account / sign-out / settings handlers.
		onSignIn,
		onSignOut,
		onOpenSettings
	}: {
		accounts: GithubAccount[];
		authErrors?: GithubAuthError[];
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
		onSignIn?: () => void;
		onSignOut?: (id: string) => void;
		onOpenSettings?: () => void;
	} = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger class={triggerClass} title={triggerTitle}>
		{@render trigger()}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content {align} {side} class="min-w-[280px]">
		{#if accounts.length > 0}
			<DropdownMenu.Group>
				<DropdownMenu.GroupHeading>{heading}</DropdownMenu.GroupHeading>
				{#each accounts as acct (acct.id)}
					{@const isSelected = acct.id === selectedAccountId}
					<DropdownMenu.Item
						class={cn('gap-2', isSelected && 'opacity-100')}
						disabled={isSelected}
						closeOnSelect={!isSelected}
						onSelect={() => onSelectAccount?.(acct.id)}
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
										class="shrink-0 rounded-sm bg-muted px-1 text-[9px] tracking-wide text-muted-foreground uppercase"
									>
										default
									</span>
								{/if}
								{#if authErrors.some((e) => e.accountId === acct.id)}
									<span
										class="shrink-0 rounded-sm bg-warning/15 px-1 text-[9px] tracking-wide text-warning uppercase"
										title="This account's sign-in expired — use “Add another account” to sign in again"
									>
										expired
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
									onSignOut?.(acct.id);
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
		<DropdownMenu.Item onSelect={() => onSignIn?.()}>
			<Plus class="size-3.5" />
			{accounts.length > 0 ? 'Add another account' : 'Sign in to GitHub'}
		</DropdownMenu.Item>
		{#if showSettings}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={() => onOpenSettings?.()}>
				<Settings class="size-3.5" />
				Settings
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
