<script lang="ts">
	import SquareTerminal from '@lucide/svelte/icons/square-terminal';
	import { Button } from './ui/button';
	import GhostIcon from './icons/GhostIcon.svelte';
	import WarpIcon from './icons/WarpIcon.svelte';
	import ITermIcon from './icons/ITermIcon.svelte';
	import TerminalAppIcon from './icons/TerminalAppIcon.svelte';
	import PowerShellIcon from './icons/PowerShellIcon.svelte';
	import { actions, app, effectiveTerminal } from '@super-review/ui/store.svelte';
	import type { TerminalKind } from '@super-review/core/types';

	const terminal = $derived<TerminalKind | null>(effectiveTerminal());
	const anyAvailable = $derived(
		app.terminals.terminal ||
			app.terminals.iterm ||
			app.terminals.warp ||
			app.terminals.ghostty ||
			app.terminals.cmd ||
			app.terminals.powershell
	);

	const terminalLabels: Record<TerminalKind, string> = {
		terminal: 'Terminal',
		iterm: 'iTerm',
		warp: 'Warp',
		ghostty: 'Ghostty',
		cmd: 'Command Prompt',
		powershell: 'PowerShell'
	};

	async function openRepo(): Promise<void> {
		await actions.openInTerminal();
	}
</script>

{#if anyAvailable}
	<Button
		variant="ghost"
		size="icon-sm"
		onclick={openRepo}
		title={terminal ? `Open in ${terminalLabels[terminal]}` : 'Open in terminal'}
	>
		{#if terminal === 'ghostty'}
			<GhostIcon class="size-4" />
		{:else if terminal === 'warp'}
			<WarpIcon class="size-4 rounded-[3px]" />
		{:else if terminal === 'iterm'}
			<ITermIcon class="size-4 rounded-[3px]" />
		{:else if terminal === 'terminal'}
			<TerminalAppIcon class="size-4" />
		{:else if terminal === 'powershell'}
			<PowerShellIcon class="size-4" />
		{:else}
			<SquareTerminal class="size-4" />
		{/if}
	</Button>
{/if}
