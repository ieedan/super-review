<script lang="ts">
	// A faithful, self-contained recreation of the desktop app's AccountSwitcher:
	// a trigger avatar that opens a dropdown of signed-in GitHub accounts, with a
	// default badge, a selected checkmark, an "expired" auth badge, and the
	// add-account / settings footer. Purely a marketing demo — no real auth.

	type Account = {
		id: string;
		login: string;
		name: string;
		tint: string;
		expired?: boolean;
	};

	const accounts: Account[] = [
		{ id: 'a', login: 'aidanbleser', name: 'Aidan Bleser', tint: 'hsl(11 100% 64%)' },
		{ id: 'b', login: 'acme-bot', name: 'Acme Release Bot', tint: 'hsl(199 89% 58%)' },
		{
			id: 'c',
			login: 'aidan-work',
			name: 'Aidan (Acme Corp)',
			tint: 'hsl(265 70% 64%)',
			expired: true
		}
	];

	let open = $state(false);
	let selectedId = $state('a');
	let defaultId = $state('a');

	const selected = $derived(accounts.find((a) => a.id === selectedId)!);
	const accountsWithError = $derived(accounts.some((a) => a.expired));

	function initials(login: string) {
		return login.slice(0, 2).toUpperCase();
	}

	function select(id: string) {
		selectedId = id;
		open = false;
	}

	// Close on outside click.
	function onWindowClick(e: MouseEvent) {
		if (!open) return;
		if (!(e.target instanceof Node)) return;
		if (!root?.contains(e.target)) open = false;
	}

	let root = $state<HTMLElement>();
</script>

<svelte:window onclick={onWindowClick} />

<div bind:this={root} class="relative inline-block text-left">
	<!-- Trigger: the active account avatar, as shown in the app header -->
	<button
		type="button"
		onclick={() => (open = !open)}
		class="border-line bg-elevated hover:border-line-bright relative flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors"
		aria-haspopup="menu"
		aria-expanded={open}
	>
		<span class="relative inline-flex">
			{@render avatar(selected, 'h-7 w-7 text-xs')}
			{#if accountsWithError}
				<span
					class="border-elevated absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 bg-flame"
					title="An account needs re-authentication"
				></span>
			{/if}
		</span>
		<span class="flex flex-col items-start leading-tight">
			<span class="text-fg text-sm font-semibold">{selected.login}</span>
			<span class="text-faint text-[11px]">{selected.name}</span>
		</span>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			class="text-faint ml-1 h-4 w-4 transition-transform {open ? 'rotate-180' : ''}"
		>
			<path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	</button>

	{#if open}
		<div
			role="menu"
			class="border-line bg-elevated absolute right-0 z-30 mt-2 w-72 origin-top-right rounded-xl border p-1.5 shadow-2xl"
			style="box-shadow: 0 30px 80px -30px hsl(6 88% 40% / 0.45);"
		>
			<div class="text-faint px-2 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
				Signed in accounts
			</div>

			{#each accounts as account (account.id)}
				{@const isSelected = account.id === selectedId}
				<button
					type="button"
					onclick={() => select(account.id)}
					class="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors {isSelected
						? 'bg-base/60'
						: 'hover:bg-base/60'}"
					role="menuitem"
				>
					{@render avatar(account, 'h-8 w-8 text-xs')}
					<span class="flex min-w-0 flex-1 flex-col leading-tight">
						<span class="flex items-center gap-1.5">
							<span class="text-fg truncate text-sm font-medium">{account.login}</span>
							{#if account.id === defaultId}
								<span
									class="rounded-full bg-add/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-add uppercase"
								>
									Default
								</span>
							{/if}
							{#if account.expired}
								<span
									class="rounded bg-del/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-del uppercase"
								>
									Expired
								</span>
							{/if}
						</span>
						<span class="text-faint truncate text-[11px]">{account.name}</span>
					</span>
					{#if isSelected}
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
							class="h-4 w-4 shrink-0 text-flame"
						>
							<path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					{:else}
						<span class="text-faint shrink-0 text-[11px] opacity-0 transition-opacity group-hover:opacity-100">
							Switch
						</span>
					{/if}
				</button>
			{/each}

			<div class="bg-line my-1.5 h-px"></div>

			<button
				type="button"
				onclick={() => (open = false)}
				class="text-muted hover:bg-base/60 hover:text-fg flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors"
				role="menuitem"
			>
				<span class="border-line flex h-8 w-8 items-center justify-center rounded-full border border-dashed">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
						<path d="M12 5v14M5 12h14" stroke-linecap="round" />
					</svg>
				</span>
				Add another account
			</button>
			<button
				type="button"
				onclick={() => (open = false)}
				class="text-muted hover:bg-base/60 hover:text-fg flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors"
				role="menuitem"
			>
				<span class="flex h-8 w-8 items-center justify-center">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4">
						<circle cx="12" cy="12" r="3" />
						<path
							d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 004.6 8a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V2a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H22a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</span>
				Settings
			</button>
		</div>
	{/if}
</div>

{#snippet avatar(account: Account, cls: string)}
	<span
		class="flex shrink-0 items-center justify-center rounded-full font-semibold text-[hsl(20_8%_8%)] {cls}"
		style="background: linear-gradient(135deg, {account.tint}, color-mix(in oklab, {account.tint} 70%, black));"
	>
		{initials(account.login)}
	</span>
{/snippet}
