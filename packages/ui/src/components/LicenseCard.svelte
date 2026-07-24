<script lang="ts">
	// A physical license card for paid plans: gold for lifetime, silver
	// for subscriptions. Tilts toward the pointer and catches the light as it
	// moves; falls flat (and still) under prefers-reduced-motion.
	let {
		variant,
		plan,
		holder,
		activeSince
	}: {
		variant: 'gold' | 'silver';
		plan: string;
		/** Whom the license is registered to. Omitted where it isn't known (e.g.
		 * the desktop, which only has the plan). */
		holder?: string;
		activeSince?: number;
	} = $props();

	let card: HTMLDivElement | undefined = $state();
	// Pointer position over the card, 0..1 in each axis. Resting pose is
	// centered so the sheen sits softly in the middle.
	let px = $state(0.5);
	let py = $state(0.5);
	let hovering = $state(false);

	function onPointerMove(event: PointerEvent): void {
		if (!card) return;
		const rect = card.getBoundingClientRect();
		px = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
		py = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
		hovering = true;
	}

	function onPointerLeave(): void {
		hovering = false;
		px = 0.5;
		py = 0.5;
	}

	const sinceLabel = $derived(
		activeSince
			? new Date(activeSince).toLocaleDateString(undefined, {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				})
			: undefined
	);
</script>

<div class="card-stage">
	<div
		bind:this={card}
		class="card {variant}"
		class:hovering
		role="presentation"
		style="--px: {px}; --py: {py};"
		onpointermove={onPointerMove}
		onpointerleave={onPointerLeave}
	>
		<div class="grain"></div>
		<div class="sheen"></div>
		<div class="glare"></div>

		<div class="face">
			<div class="flex items-start justify-between">
				<span class="font-display text-lg font-bold tracking-tight">Super Review</span>
				<span class="plan-chip">{plan}</span>
			</div>

			<div class="flex items-end justify-between gap-4">
				{#if holder}
					<div class="min-w-0">
						<div class="field-label">Licensed to</div>
						<div class="holder-name" title={holder}>{holder}</div>
					</div>
				{/if}
				{#if sinceLabel}
					<div class="shrink-0 text-right">
						<div class="field-label">Active since</div>
						<div class="field-value">{sinceLabel}</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.card-stage {
		perspective: 1100px;
		width: 100%;
		max-width: 26rem;
	}

	.card {
		position: relative;
		aspect-ratio: 1.586;
		width: 100%;
		border-radius: 1.25rem;
		overflow: hidden;
		transform: rotateX(calc((0.5 - var(--py)) * 10deg)) rotateY(calc((var(--px) - 0.5) * 12deg));
		transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
		transform-style: preserve-3d;
		touch-action: pan-y;
	}
	.card.hovering {
		transition: transform 0.08s linear;
	}

	.gold {
		color: #38290a;
		background:
			radial-gradient(120% 160% at 15% 0%, rgba(255, 246, 213, 0.55) 0%, transparent 45%),
			linear-gradient(
				128deg,
				#8f6b1e 0%,
				#c9a03c 18%,
				#f0d67c 38%,
				#f9edb6 50%,
				#e3bd55 64%,
				#a37c25 85%,
				#c9a33f 100%
			);
		border: 1px solid rgba(255, 240, 190, 0.55);
		box-shadow:
			0 24px 60px -18px rgba(212, 175, 55, 0.4),
			0 8px 24px -12px rgba(0, 0, 0, 0.6);
	}

	.silver {
		color: #22262b;
		background:
			radial-gradient(120% 160% at 15% 0%, rgba(255, 255, 255, 0.5) 0%, transparent 45%),
			linear-gradient(
				128deg,
				#6b7178 0%,
				#9aa1a8 18%,
				#d4dade 38%,
				#f0f3f5 50%,
				#b8bfc6 64%,
				#7d848b 85%,
				#a6adb4 100%
			);
		border: 1px solid rgba(255, 255, 255, 0.55);
		box-shadow:
			0 24px 60px -18px rgba(180, 190, 200, 0.35),
			0 8px 24px -12px rgba(0, 0, 0, 0.6);
	}

	/* Fine metallic texture so the surface reads as brushed metal, not flat paint. */
	.grain {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			105deg,
			rgba(255, 255, 255, 0.06) 0px,
			rgba(255, 255, 255, 0.06) 1px,
			transparent 1px,
			transparent 3px
		);
		mix-blend-mode: overlay;
		pointer-events: none;
	}

	/* Broad band of light that sweeps across as the pointer travels. */
	.sheen {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			115deg,
			transparent 20%,
			rgba(255, 255, 255, 0.55) 48%,
			rgba(255, 255, 255, 0.15) 54%,
			transparent 80%
		);
		background-size: 260% 100%;
		background-position-x: calc((1 - var(--px)) * 100%);
		mix-blend-mode: soft-light;
		pointer-events: none;
	}

	/* Tight highlight that follows the pointer, like a spot reflection. */
	.glare {
		position: absolute;
		inset: 0;
		background: radial-gradient(
			34rem circle at calc(var(--px) * 100%) calc(var(--py) * 100%),
			rgba(255, 255, 255, 0.5),
			transparent 42%
		);
		mix-blend-mode: overlay;
		opacity: 0;
		transition: opacity 0.4s ease;
		pointer-events: none;
	}
	.card.hovering .glare {
		opacity: 1;
	}

	.face {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: 1.5rem;
		text-shadow:
			0 1px 0 rgba(255, 255, 255, 0.35),
			0 -1px 0 rgba(0, 0, 0, 0.2);
	}

	.plan-chip {
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		padding: 0.25rem 0.625rem;
		border-radius: 9999px;
		border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
		background: color-mix(in srgb, currentColor 8%, transparent);
	}

	.field-label {
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.65;
	}

	.holder-name {
		font-size: 1.125rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.field-value {
		font-size: 0.875rem;
		font-weight: 600;
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.card.hovering {
			transform: none;
			transition: none;
		}
	}
</style>
