<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import Check from '@lucide/svelte/icons/check';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { Button } from './ui/button';
	import { actions, app } from '$lib/store.svelte';
	import { cn } from '$lib/utils';

	const status = $derived(app.pushStatus);
	const busy = $derived(app.push.inProgress);
	const stage = $derived(app.push.stage);

	// No write access to origin — pushing/publishing has to fork first. Route the
	// click through the fork dialog instead of a push that would be rejected.
	function onPushClick(): void {
		if (app.repoPushAccess === false) {
			actions.promptFork('push');
			return;
		}
		void actions.push();
	}

	const label = $derived.by(() => {
		if (busy) {
			switch (stage) {
				case 'fetching':
					return 'Fetching';
				case 'pulling':
					return 'Pulling';
				case 'pushing':
					return 'Pushing';
				case 'conflicts':
					return 'Conflicts';
				default:
					return 'Working';
			}
		}
		if (!status?.hasUpstream) return 'Publish';
		if (status.behind > 0 && status.ahead > 0) return `Sync ${status.ahead}↑ ${status.behind}↓`;
		if (status.behind > 0) return `Pull ${status.behind}`;
		if (status.ahead > 0) return `Push ${status.ahead}`;
		return 'Up to date';
	});

	const title = $derived.by(() => {
		if (!status) return 'Push';
		const parts: string[] = [];
		if (status.branch) parts.push(`Branch: ${status.branch}`);
		parts.push(`Ahead ${status.ahead}, behind ${status.behind}`);
		if (!status.hasUpstream) parts.push('No upstream, set on push');
		return parts.join(' · ');
	});

	const disabled = $derived.by(() => {
		if (busy) return true;
		if (!status?.hasRemote) return true;
		if (!status.hasUpstream) return false; // first push needs to work
		return status.ahead === 0 && status.behind === 0;
	});

	const Icon = $derived.by(() => {
		if (busy) return Loader2;
		if (!status?.hasUpstream) return ArrowUpFromLine;
		if (status.behind > 0 && status.ahead > 0) return ArrowUp;
		if (status.behind > 0) return ArrowDown;
		if (status.ahead > 0) return ArrowUp;
		return Check;
	});
</script>

{#if status?.hasRemote}
	<Button
		variant={status && (status.ahead > 0 || !status.hasUpstream) ? 'default' : 'ghost'}
		size="sm"
		{disabled}
		onclick={onPushClick}
		{title}
	>
		<Icon class={cn('size-3.5', busy && 'animate-spin')} />
		<span class="hidden text-xs sm:inline">{label}</span>
	</Button>
{/if}
