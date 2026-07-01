<script lang="ts">
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import { actions, app } from '@super-review/ui/store.svelte';

	// Presentational only: the device flow is driven by actions.openGithubSignIn
	// (which calls startGithubSignInFlow in the store). This component just renders
	// the flow's state and routes user-initiated close back through the action.
	const signIn = $derived(app.githubSignIn);
</script>

<Dialog.Root
	open={signIn.open}
	onOpenChange={(o) => {
		if (!o) actions.closeGithubSignIn();
	}}
>
	<!-- Raised onto a higher layer than the base dialogs (z-50) so it stacks above
		the Settings dialog when opened from its "Add another account" button. -->
	<Dialog.Content class="z-[60] w-[420px]" overlayClass="z-[60]">
		<Dialog.Header>
			<Dialog.Title>Sign in to GitHub</Dialog.Title>
		</Dialog.Header>
		{#if signIn.error}
			<p
				class="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
			>
				{signIn.error}
			</p>
		{/if}
		{#if signIn.userCode && signIn.verificationUri}
			<p class="text-sm text-muted-foreground">Enter this code in your browser:</p>
			<div
				class="rounded-md border border-border bg-card p-3 text-center font-mono text-2xl tracking-[0.3em]"
			>
				{signIn.userCode}
			</div>
			<p class="text-xs text-muted-foreground">
				Verification URL:
				<a class="underline" href={signIn.verificationUri} target="_blank" rel="noreferrer">
					{signIn.verificationUri}
				</a>
			</p>
			{#if signIn.polling}
				<p class="text-xs text-muted-foreground">Waiting for confirmation…</p>
			{/if}
		{:else if !signIn.error}
			<p class="text-sm text-muted-foreground">Starting device flow…</p>
		{/if}
		<Dialog.Footer>
			<Button variant="secondary" size="sm" onclick={() => actions.closeGithubSignIn()}
				>Cancel</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
