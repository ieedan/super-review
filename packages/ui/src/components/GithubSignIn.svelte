<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import { buttonVariants } from './ui/button';
	import * as Avatar from './ui/avatar';
	import AccountSwitcher from './AccountSwitcher.svelte';
	import {
		actions,
		app,
		effectiveAccountAuthError,
		effectiveGithubAccount
	} from '@super-review/ui/store.svelte';
	import { cn } from '@super-review/ui/utils';

	// Shows the account the current project authenticates as (its pin, else the
	// app-wide default) and switches the project's account — same behavior as the
	// commit-box switcher.
	const account = $derived(effectiveGithubAccount());

	// The account's token stopped authenticating — badge the chip so the broken
	// state is visible even when the commit box (with its banner) is out of view.
	const authError = $derived(effectiveAccountAuthError());
</script>

<AccountSwitcher
	align="end"
	heading="Account for this project"
	selectedAccountId={account?.id}
	defaultAccountId={app.activeGithubAccount?.id}
	isPinned={!!app.activeRepo?.githubAccountId}
	onSelectAccount={(id) => actions.setRepoGithubAccount(id)}
	onUseDefault={() => actions.setRepoGithubAccount(null)}
	triggerTitle={authError
		? `GitHub sign-in for ${authError.login} has expired — sign in again`
		: account
			? `This project uses ${account.login}. Click to switch`
			: 'Account'}
	triggerClass={cn(
		buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
		'relative rounded-full p-0'
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
			{#if authError}
				<span
					class="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border border-background bg-warning"
				></span>
			{/if}
		{:else}
			<Avatar.Root class="size-6">
				<Avatar.Fallback>
					<User class="size-3.5" />
				</Avatar.Fallback>
			</Avatar.Root>
		{/if}
	{/snippet}
</AccountSwitcher>
