<script lang="ts">
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import { actions, app } from '$lib/store.svelte';

	let userCode = $state<string | null>(null);
	let verificationUri = $state<string | null>(null);
	let polling = $state(false);
	let errorMsg = $state<string | null>(null);
	let pollHandle: number | null = null;
	let activeFlow = $state(false);

	let dialogOpen = $derived(app.githubSignInOpen);

	function stopPolling(): void {
		if (pollHandle !== null) {
			window.clearInterval(pollHandle);
			pollHandle = null;
		}
		polling = false;
	}

	function reset(): void {
		stopPolling();
		userCode = null;
		verificationUri = null;
		errorMsg = null;
		activeFlow = false;
	}

	function close(): void {
		if (activeFlow) void window.api.github.cancelDeviceFlow();
		reset();
		actions.closeGithubSignIn();
	}

	async function startFlow(): Promise<void> {
		if (activeFlow) return;
		activeFlow = true;
		errorMsg = null;
		try {
			const flow = await window.api.github.startDeviceFlow();
			userCode = flow.userCode;
			verificationUri = flow.verificationUri;
			polling = true;
			pollHandle = window.setInterval(async () => {
				const status = await window.api.github.pollDeviceFlow();
				if (status.state === 'success') {
					stopPolling();
					activeFlow = false;
					userCode = null;
					verificationUri = null;
					// Close the dialog before the await below. Resetting the flow guards
					// (activeFlow/userCode/errorMsg) while dialogOpen is still true would
					// let the start-flow $effect re-fire during the await and kick off a
					// second device flow — opening a duplicate verification tab.
					actions.closeGithubSignIn();
					await actions.refreshGithubAccounts();
					if (app.activeRepo?.githubOwner && app.activeRepo.githubRepo) {
						void actions.loadPRs();
					}
				} else if (status.state === 'error') {
					stopPolling();
					activeFlow = false;
					errorMsg = status.message;
				}
			}, 1500);
		} catch (err) {
			activeFlow = false;
			errorMsg = err instanceof Error ? err.message : String(err);
		}
	}

	// Kick off the device flow when the dialog is opened.
	$effect(() => {
		if (dialogOpen && !activeFlow && !userCode && !errorMsg) {
			void startFlow();
		}
		if (!dialogOpen) reset();
	});
</script>

<Dialog.Root bind:open={dialogOpen} onOpenChange={(o) => !o && close()}>
	<Dialog.Content class="w-[420px]">
		<Dialog.Header>
			<Dialog.Title>Sign in to GitHub</Dialog.Title>
		</Dialog.Header>
		{#if errorMsg}
			<p
				class="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
			>
				{errorMsg}
			</p>
		{/if}
		{#if userCode && verificationUri}
			<p class="text-sm text-muted-foreground">Enter this code in your browser:</p>
			<div
				class="rounded-md border border-border bg-card p-3 text-center font-mono text-2xl tracking-[0.3em]"
			>
				{userCode}
			</div>
			<p class="text-xs text-muted-foreground">
				Verification URL:
				<a class="underline" href={verificationUri} target="_blank" rel="noreferrer">
					{verificationUri}
				</a>
			</p>
			{#if polling}
				<p class="text-xs text-muted-foreground">Waiting for confirmation…</p>
			{/if}
		{:else if !errorMsg}
			<p class="text-sm text-muted-foreground">Starting device flow…</p>
		{/if}
		<Dialog.Footer>
			<Button variant="secondary" size="sm" onclick={close}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
