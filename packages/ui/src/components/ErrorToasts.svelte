<!--
	Error toasts: a Sonner-style stack in the bottom-right corner via Stack.
	Collapsed, only the newest toast is fully visible with the rest peeking behind
	it; hovering (or focusing in) fans the stack out so every toast is readable and
	individually actionable. Identical consecutive errors don't stack a duplicate —
	the store collapses them into the newest toast, bumping its ×N count and giving
	it a shake. Per-toast actions: expand the raw message, copy it, file a one-click
	feedback report (prefilled with the error + captured context), or dismiss it.
-->
<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import Bug from '@lucide/svelte/icons/bug';
	import * as Tooltip from './ui/tooltip';
	import Stack from './stack/Stack.svelte';
	import { actions, app, dismissError } from '@super-review/ui/store.svelte';
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import type { ErrorToast } from '@super-review/core/types';

	// Per-toast UI state keyed by toast id: which have their details expanded and
	// which just showed a "copied" checkmark. SvelteSets so the template stays
	// reactive as toasts come and go.
	import { SvelteSet, SvelteMap } from 'svelte/reactivity';
	const detailsOpen = new SvelteSet<string>();
	const copied = new SvelteSet<string>();
	const copyResetIds = new SvelteMap<string, number>();

	const animations = useAnimations();

	// Front-first for Stack: the newest error is index 0 (fully visible front),
	// older ones peek behind it and the stack grows upward.
	const toasts = $derived([...app.errors].reverse());

	// Re-trigger a brief shake only when a toast's `bump` actually increases — i.e.
	// the same error fired again and collapsed into this toast instead of stacking
	// a duplicate. We track the previous bump in the closure because the action's
	// `update` also fires on unrelated re-renders (e.g. when a *different* error is
	// appended); shaking then would be spurious. Only when accent-level motion is
	// on (the ×N badge still signals the repeat otherwise), and never on first
	// mount since `update` runs only after changes.
	function shake(node: HTMLElement, bump: number) {
		let prev = bump;
		return {
			update(next: number) {
				if (next === prev) return;
				prev = next;
				if (!animations.accentsEnabled) return;
				node.classList.remove('animate-error-shake');
				void node.offsetWidth; // force reflow so the animation restarts
				node.classList.add('animate-error-shake');
			}
		};
	}

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

{#if toasts.length > 0}
	<Stack items={toasts} onDismiss={(t) => dismissError(t.id)} fixed gap={12}>
		{#snippet card(toast, { dismiss })}
			<div
				role="alert"
				use:shake={toast.bump}
				onanimationend={(e) => e.currentTarget.classList.remove('animate-error-shake')}
				class="relative isolate flex flex-col gap-2 overflow-hidden rounded-lg border border-destructive/50 bg-card/90 p-3 text-sm text-destructive shadow-lg backdrop-blur-md before:absolute before:inset-0 before:-z-10 before:bg-destructive/10 before:content-['']"
			>
				<div class="flex items-start gap-2">
					<TriangleAlert class="size-5 shrink-0" />
					<span class="flex-1 pt-0.5 font-medium">
						{toast.context?.action
							? `Error while ${toast.context.action.toLowerCase()}`
							: 'An error occurred'}
					</span>
					{#if toast.count > 1}
						<span
							class="shrink-0 rounded-full bg-destructive/20 px-1.5 py-0.5 text-xs font-semibold tabular-nums"
							aria-label={`Occurred ${toast.count} times`}
							title={`This error has occurred ${toast.count} times`}
						>
							×{toast.count}
						</span>
					{/if}
					<button
						class="rounded p-0.5 hover:bg-destructive/20"
						onclick={dismiss}
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
		{/snippet}
	</Stack>
{/if}
