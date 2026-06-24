<!--
	Stack of error toasts, newest at the bottom. Each error gets its own toast so a
	new failure never overwrites one the user hasn't seen. Per-toast actions:
	expand the raw message, copy it, file a one-click feedback report (prefilled
	with the error + captured context), or dismiss just that toast.
-->
<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import Bug from '@lucide/svelte/icons/bug';
	import * as Tooltip from './ui/tooltip';
	import { actions, app, dismissError } from '$lib/store.svelte';
	import type { ErrorToast } from '@shared/types';

	// Per-toast UI state keyed by toast id: which have their details expanded and
	// which just showed a "copied" checkmark. SvelteSets so the template stays
	// reactive as toasts come and go.
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	const detailsOpen = new SvelteSet<string>();
	const copied = new SvelteSet<string>();
	const copyResetIds = new SvelteMap<string, number>();

	function toggleDetails(id: string): void {
		if (detailsOpen.has(id)) detailsOpen.delete(id);
		else detailsOpen.add(id);
	}

	function copy(toast: ErrorToast): void {
		void navigator.clipboard.writeText(toast.message);
		copied.add(toast.id);
		clearTimeout(copyResetIds.get(toast.id));
		copyResetIds.set(
			toast.id,
			window.setTimeout(() => copied.delete(toast.id), 1500)
		);
	}
</script>

{#if app.errors.length > 0}
	<div class="fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2">
		{#each app.errors as toast (toast.id)}
			<div
				role="alert"
				class="flex flex-col gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive shadow-lg backdrop-blur"
			>
				<div class="flex items-start gap-2">
					<TriangleAlert class="size-5 shrink-0" />
					<span class="flex-1 pt-0.5 font-medium">
						{toast.context?.action
							? `Error while ${toast.context.action.toLowerCase()}`
							: 'An error occurred'}
					</span>
					<button
						class="rounded p-0.5 hover:bg-destructive/20"
						onclick={() => dismissError(toast.id)}
						aria-label="Dismiss"
					>
						<X class="size-3.5" />
					</button>
				</div>
				<div class="flex items-center gap-1.5 pl-7">
					<button
						class="rounded border border-destructive/50 px-2 py-1 text-xs hover:bg-destructive/20"
						onclick={() => toggleDetails(toast.id)}
						aria-expanded={detailsOpen.has(toast.id)}
					>
						{detailsOpen.has(toast.id) ? 'Hide Details' : 'Show Details'}
					</button>
					<button
						class="flex items-center gap-1 rounded border border-destructive/50 px-2 py-1 text-xs hover:bg-destructive/20"
						onclick={() => actions.reportErrorToast(toast)}
					>
						<Bug class="size-3.5" />
						Report
					</button>
					<Tooltip.Provider delayDuration={150}>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										class="rounded border border-destructive/50 p-1 hover:bg-destructive/20"
										onclick={() => copy(toast)}
										aria-label="Copy error"
									>
										{#if copied.has(toast.id)}
											<Check class="size-3.5" />
										{:else}
											<Copy class="size-3.5" />
										{/if}
									</button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content
								side="top"
								class="border border-border bg-popover text-popover-foreground shadow-md"
								arrowClasses="bg-popover fill-popover"
							>
								{copied.has(toast.id) ? 'Copied' : 'Copy error'}
							</Tooltip.Content>
						</Tooltip.Root>
					</Tooltip.Provider>
				</div>
				{#if detailsOpen.has(toast.id)}
					<pre
						class="ml-7 max-h-48 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-2 font-mono text-xs whitespace-pre-wrap">{toast.message}</pre>
				{/if}
			</div>
		{/each}
	</div>
{/if}
