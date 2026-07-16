<script lang="ts">
	function focusWaitlist(): void {
		const el = document.querySelector<HTMLInputElement>('#waitlist input');
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		el?.focus({ preventScroll: true });
	}
</script>

<div class="header-anchor sticky top-0 z-50 flex justify-center">
	<header
		class="header-bar flex w-full max-w-6xl items-center justify-between border border-transparent bg-transparent py-5 shadow-none backdrop-blur-none"
	>
		<a href="/" class="flex min-w-0 items-center gap-2.5">
			<img src="/icon.png" alt="" class="header-icon block size-8 rounded-lg shadow-lg" />
			<span class="header-text font-display text-lg leading-5 font-bold tracking-tight">
				Super Review
			</span>
		</a>
		<button
			type="button"
			onclick={focusWaitlist}
			class="header-cta border-line text-muted-foreground hover:text-fg inline-flex shrink-0 items-center rounded-lg border px-4 py-2 text-sm leading-5 font-semibold transition-colors"
		>
			Join Waitlist
		</button>
	</header>
</div>

<style>
	@supports (animation-timeline: scroll()) {
		.header-anchor {
			animation: header-drop linear both;
			animation-timeline: scroll(root block);
			animation-range: 0 4rem;
		}

		.header-bar {
			animation: header-bar linear both;
			animation-timeline: scroll(root block);
			animation-range: 0 4rem;
		}

		.header-icon {
			animation: header-icon linear both;
			animation-timeline: scroll(root block);
			animation-range: 0 4rem;
		}

		.header-text {
			animation: header-text linear both;
			animation-timeline: scroll(root block);
			animation-range: 0 4rem;
		}

		.header-cta {
			animation: header-cta linear both;
			animation-timeline: scroll(root block);
			animation-range: 0 4rem;
		}
	}

	@keyframes -global-header-drop {
		from {
			padding-top: 0;
			padding-inline: 0;
		}
		to {
			padding-top: 1rem;
			padding-inline: 1rem;
		}
	}

	@keyframes -global-header-bar {
		from {
			max-width: 72rem;
			padding-block: 1.25rem;
			padding-inline: 0;
			border-radius: 0;
			background-color: transparent;
			border-color: transparent;
			box-shadow: none;
			backdrop-filter: blur(0);
		}
		to {
			max-width: 64rem;
			padding-block: 0.625rem;
			padding-inline: 1rem;
			border-radius: 0.75rem;
			background-color: color-mix(in srgb, var(--color-elevated) 85%, transparent);
			border-color: var(--color-line);
			box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.2);
			backdrop-filter: blur(12px);
		}
	}

	@keyframes -global-header-icon {
		from {
			width: 2rem;
			height: 2rem;
			border-radius: 0.5rem;
		}
		to {
			width: 1.5rem;
			height: 1.5rem;
			border-radius: 0.375rem;
		}
	}

	@keyframes -global-header-text {
		from {
			font-size: 1.125rem;
		}
		to {
			font-size: 0.875rem;
		}
	}

	@keyframes -global-header-cta {
		from {
			padding-block: 0.5rem;
			padding-inline: 1rem;
			font-size: 0.875rem;
		}
		to {
			padding-block: 0.375rem;
			padding-inline: 0.75rem;
			font-size: 0.75rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.header-anchor,
		.header-bar,
		.header-icon,
		.header-text,
		.header-cta {
			animation: none;
		}
	}
</style>
