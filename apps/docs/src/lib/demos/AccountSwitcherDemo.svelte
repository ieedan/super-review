<script lang="ts">
	// Mounts the REAL AccountSwitcher from @super-review/ui — the same component
	// the desktop app renders — fed with mock accounts and local selection state.
	import { AccountSwitcher, Avatar } from '@super-review/ui';
	import type { GithubAccount, GithubAuthError } from '@super-review/ui';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	const accounts: GithubAccount[] = [
		{ id: 'a', login: 'aidanbleser', name: 'Aidan Bleser', addedAt: 0 },
		{ id: 'b', login: 'acme-bot', name: 'Acme Release Bot', addedAt: 0 },
		{ id: 'c', login: 'aidan-work', name: 'Aidan (Acme Corp)', addedAt: 0 }
	];

	// The work account's SAML session lapsed — surfaced as the "expired" badge.
	const authErrors: GithubAuthError[] = [{ accountId: 'c', login: 'aidan-work', reason: 'sso' }];

	let selectedId = $state('a');
	const defaultId = 'a';

	const selected = $derived(accounts.find((acct) => acct.id === selectedId)!);
</script>

<div class="sr-surface flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-border p-10">
	<span class="font-mono text-xs text-muted-foreground">Super Review · header</span>

	<AccountSwitcher
		{accounts}
		{authErrors}
		heading="Account for this project"
		selectedAccountId={selectedId}
		defaultAccountId={defaultId}
		onSelectAccount={(id) => (selectedId = id)}
		triggerClass="group relative inline-flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
		triggerTitle={`This project uses ${selected.login}. Click to switch`}
	>
		{#snippet trigger()}
			<Avatar.Root class="size-9">
				<Avatar.Fallback class="text-xs">
					{selected.login.slice(0, 2).toUpperCase()}
				</Avatar.Fallback>
			</Avatar.Root>
			<span
				class="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
			>
				<ChevronDown class="size-2.5" />
			</span>
		{/snippet}
	</AccountSwitcher>

	<span class="text-center text-xs text-muted-foreground">
		Switch the active reviewer for this repo
	</span>
</div>
