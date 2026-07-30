<script lang="ts">
	// "Sign in to <harness>" — shown when a generation run reaches a harness CLI
	// that has no session.
	//
	// Deliberately not an error toast. Nothing broke and nothing failed in the
	// user's work: a CLI needs signing in, which is setup, so it gets a calm
	// dialog with the fix rather than a red card in the error stack with a
	// "Report" button next to it.
	//
	// There is nothing for us to drive here (contrast GithubSignInDialog, which
	// owns a device flow): these CLIs authenticate through their own interactive
	// terminal flow. So the dialog's whole job is to hand over the exact command,
	// get the user into a terminal, and then let them say they're done.
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Settings from '@lucide/svelte/icons/settings';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import HarnessLogo from './HarnessLogo.svelte';
	import { actions, app, effectiveTerminal } from '@super-review/ui/store.svelte';
	import { harnessLabel, harnessLoginRecipe } from '@super-review/core/types';

	const signIn = $derived(app.harnessSignIn);
	const harness = $derived(signIn.harness);
	const recipe = $derived(harness ? harnessLoginRecipe(harness) : null);
	// No point offering to open a terminal we haven't detected.
	const terminal = $derived(effectiveTerminal());

	let copied = $state(false);
	let copyResetId: number | undefined;

	function copyCommand(): void {
		if (!harness) return;
		void actions.copyHarnessLoginCommand(harness);
		copied = true;
		clearTimeout(copyResetId);
		copyResetId = window.setTimeout(() => (copied = false), 1500);
	}
</script>

<Dialog.Root
	open={signIn.open}
	onOpenChange={(o) => {
		if (!o) actions.closeHarnessSignIn();
	}}
>
	<!-- Raised above the base dialog layer for the same reason GithubSignInDialog
	     is: this can be opened from the notice while Settings is on screen. -->
	<Dialog.Content class="z-[60] w-[440px]" overlayClass="z-[60]">
		{#if harness && recipe}
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					<HarnessLogo {harness} size={18} class="shrink-0" />
					Sign in to {harnessLabel(harness)}
				</Dialog.Title>
			</Dialog.Header>

			<p class="text-sm text-muted-foreground">
				Super Review runs the {harnessLabel(harness)} CLI to write commit messages and changesets. It
				has no active session right now, so there's nothing to generate with.
			</p>

			{#if recipe.then}
				<!-- Numbered only when there really are two steps: the interactive
				     harnesses drop you into a TUI where the login is a slash command, and
				     "run claude then /login" as one sentence reads like one command. A
				     lone "1." for the single-step CLIs would be noise. -->
				<ol class="flex flex-col gap-2 text-sm">
					<li class="flex items-baseline gap-2">
						<span class="text-muted-foreground tabular-nums">1.</span>
						<span>
							Run
							<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]"
								>{recipe.command}</code
							>
							in a terminal
						</span>
					</li>
					<li class="flex items-baseline gap-2">
						<span class="text-muted-foreground tabular-nums">2.</span>
						<span>
							Type
							<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{recipe.then}</code
							>
							at its prompt and follow the sign-in
						</span>
					</li>
				</ol>
			{:else}
				<p class="text-sm">
					Run
					<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{recipe.command}</code>
					in a terminal and follow the sign-in.
				</p>
			{/if}

			<!-- The two helpers for carrying out the steps above, so they sit with the
			     steps rather than competing with Cancel/confirm in the footer. -->
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={copyCommand}>
					{#if copied}
						<Check class="size-3.5" /> Copied
					{:else}
						<Copy class="size-3.5" /> Copy command
					{/if}
				</Button>
				{#if terminal}
					<Button variant="outline" size="sm" onclick={() => void actions.openInTerminal()}>
						<TerminalIcon class="size-3.5" />
						Open terminal
					</Button>
				{/if}
			</div>

			{#if signIn.recheckFailed}
				<p class="rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
					{harnessLabel(harness)} still has no session. Finish the sign-in in your terminal, then try
					again.
				</p>
			{/if}

			<!-- Signing this CLI back in isn't the only way out: another installed
			     agent will do the job. Rather than list them here, hand the user to
			     the place that already shows every agent with its auth state and
			     model. Sits apart from Cancel/confirm — it's a way out, not a
			     dismissal. -->
			<Dialog.Footer class="sm:justify-between">
				<Button variant="ghost" size="sm" onclick={() => actions.openAgentSettingsFromSignIn()}>
					<Settings class="size-3.5" />
					Agent settings
				</Button>
				<div class="flex items-center gap-2">
					<Button variant="secondary" size="sm" onclick={() => actions.closeHarnessSignIn()}>
						Cancel
					</Button>
					<Button
						size="sm"
						disabled={signIn.checking}
						onclick={() => void actions.recheckHarnessSignIn()}
					>
						{#if signIn.checking}
							<LoaderCircle class="size-3.5 animate-spin" /> Checking…
						{:else}
							I've signed in
						{/if}
					</Button>
				</div>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
