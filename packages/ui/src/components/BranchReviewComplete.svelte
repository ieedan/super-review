<script lang="ts">
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import { fade } from 'svelte/transition';
	import { backOut, cubicOut } from 'svelte/easing';
	import { Button } from './ui/button';
	import { actions, app, uiPR } from '@super-review/ui/store.svelte';

	// `animateEntrance` is set by the store only when the user finishes the last
	// change in place; it's false when this state mounts because they switched
	// back to an already-finished branch, so re-entry is instant.
	let { animateEntrance = false }: { animateEntrance?: boolean } = $props();

	// The PR that whatever's on screen acts on (a viewed PR/branch in read-only
	// mode, else the checked-out branch's PR). Its presence decides the primary
	// action: open the existing PR to approve, or kick off creating one.
	const pr = $derived(uiPR());

	// Play the entrance only on the initial completion AND when accent-level
	// motion is on ('accents' or 'all'); otherwise the state appears instantly
	// (durations → 0). It's not gated on the overlay-surface ('all') level, since
	// this isn't a menu or dialog.
	const animate = $derived(animateEntrance && app.animations !== 'none');
	const ITEM_DURATION = $derived(animate ? 320 : 0);
	const BACKDROP_DURATION = $derived(animate ? 220 : 0);
	// Each element (icon → title → description → primary → secondary) enters one
	// STAGGER after the previous, so the card assembles top-to-bottom rather than
	// all at once. `stagger(i)` is the delay for the i-th item.
	const STAGGER = 70;
	const stagger = (i: number): number => (animate ? i * STAGGER : 0);

	// Tasteful entrance: each item fades and de-blurs up into place with a slight
	// overshoot on the scale (backOut), so it "settles" rather than snapping.
	// Opacity and blur ease on their own curve (cubicOut) so the item is sharp and
	// fully visible before the overshoot finishes.
	function pop(_node: Element, { delay = 0 }: { delay?: number } = {}) {
		return {
			delay,
			duration: ITEM_DURATION,
			css: (t: number) => {
				const e = backOut(t);
				const o = cubicOut(t);
				return `opacity: ${o}; filter: blur(${(1 - o) * 6}px); transform: translateY(${(1 - e) * 10}px) scale(${0.95 + e * 0.05});`;
			}
		};
	}

	function primaryAction(): void {
		// "Approve PR" just takes the reviewer to the PR on GitHub; "Create PR"
		// opens the compare page. Both mirror the header's PrimaryActionButton.
		if (pr?.url) {
			void window.api.shell.openExternal(pr.url);
			return;
		}
		void actions.openPRPage();
	}
</script>

<!-- Covers the diff list while the branch is fully reviewed. The list stays
     mounted underneath, so "Keep Reviewing" just unmounts this overlay and the
     reviewer is back where they were. -->
<div
	class="absolute inset-0 z-10 grid place-items-center bg-background/95 backdrop-blur-sm"
	transition:fade={{ duration: BACKDROP_DURATION }}
>
	<div class="flex w-full max-w-sm flex-col items-center px-6 text-center">
		<div
			class="mb-5 grid size-16 place-items-center rounded-full bg-success/10"
			in:pop={{ delay: stagger(0) }}
		>
			<CheckCheck class="size-8 text-success" />
		</div>
		<h2 class="text-xl font-semibold" in:pop={{ delay: stagger(1) }}>You've seen it all!</h2>
		<p class="mt-2 text-sm text-muted-foreground" in:pop={{ delay: stagger(2) }}>
			You've reviewed every change on this branch.
		</p>
		<div class="mt-6 flex items-center justify-center gap-2">
			<div in:pop={{ delay: stagger(3) }}>
				<Button onclick={primaryAction}>
					{#if pr}
						<ExternalLink class="size-4" />
						Approve PR #{pr.number}
					{:else}
						<GitPullRequest class="size-4" />
						Create PR
					{/if}
				</Button>
			</div>
			<div in:pop={{ delay: stagger(4) }}>
				<Button variant="ghost" onclick={() => actions.dismissSeenItAll()}>Keep Reviewing</Button>
			</div>
		</div>
	</div>
</div>
