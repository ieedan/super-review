<script lang="ts">
	import { onMount } from 'svelte';
	import { Spring } from 'svelte/motion';

	const SCROLL_DOWN = 40;
	const SCROLL_UP = 8;

	// 0 = home, 1 = compact pill. Light ease-in when compacting; instant when expanding.
	const progress = new Spring(0, {
		stiffness: 0.1,
		damping: 0.58
	});

	function setCompact(next: boolean, reducedMotion: boolean) {
		if (reducedMotion || !next) {
			progress.set(next ? 1 : 0, { hard: true });
		} else {
			progress.set(1);
		}
	}

	function focusWaitlist(): void {
		const el = document.querySelector<HTMLInputElement>('#waitlist input');
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		el?.focus({ preventScroll: true });
	}

	onMount(() => {
		const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
		let compact = window.scrollY > SCROLL_DOWN;

		setCompact(compact, reduced.matches);

		const onScroll = () => {
			const y = window.scrollY;
			const next = compact ? y > SCROLL_UP : y > SCROLL_DOWN;
			if (next === compact) return;
			compact = next;
			setCompact(next, reduced.matches);
		};

		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});
</script>

<div class="header-anchor sticky top-0 z-50 flex justify-center" style={`--p: ${progress.current}`}>
	<header class="header-bar flex w-full items-center justify-between">
		<a href="/" class="flex min-w-0 items-center gap-2 sm:gap-2.5">
			<img src="/icon.png" alt="" class="size-6 rounded-md shadow-lg sm:size-8 sm:rounded-lg" />
			<span
				class="font-display text-sm leading-4 font-bold tracking-tight sm:text-lg sm:leading-5"
			>
				Super Review
			</span>
		</a>
		<button
			type="button"
			onclick={focusWaitlist}
			class="border-line text-muted-foreground hover:text-fg inline-flex shrink-0 items-center rounded-lg border px-3 py-1.5 text-xs leading-4 font-semibold transition-colors sm:px-4 sm:py-2 sm:text-sm sm:leading-5"
		>
			Join Waitlist
		</button>
	</header>
</div>

<style>
	.header-anchor {
		padding-top: calc(var(--p, 0) * 1rem);
		padding-inline: calc(var(--p, 0) * 1rem);
	}

	.header-bar {
		max-width: calc(72rem - var(--p, 0) * 7.2rem);
		padding-block: calc(1.25rem - var(--p, 0) * 0.625rem);
		padding-inline: calc(var(--p, 0) * 1rem);
		border-radius: calc(var(--p, 0) * 0.75rem);
		border: 1px solid
			color-mix(in srgb, var(--color-line) calc(var(--p, 0) * 100%), transparent);
		background-color: color-mix(
			in srgb,
			color-mix(in srgb, var(--color-elevated) 85%, transparent) calc(var(--p, 0) * 100%),
			transparent
		);
		box-shadow: 0 calc(var(--p, 0) * 10px) calc(var(--p, 0) * 15px) calc(var(--p, 0) * -3px)
			rgb(0 0 0 / calc(var(--p, 0) * 0.2));
		backdrop-filter: blur(calc(var(--p, 0) * 12px));
	}
</style>
