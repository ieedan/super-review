<script lang="ts">
	let { animationDelay = '880ms' }: { animationDelay?: string } = $props();
</script>

<div
	class="reveal flex max-w-2xl flex-col items-center px-2 py-14 text-center sm:py-16"
	style={animationDelay ? `animation-delay: ${animationDelay}` : undefined}
>
	<div class="ring-line bg-elevated size-20 overflow-hidden rounded-full ring-1 sm:size-24">
		<img
			src="https://github.com/ieedan.png"
			alt="Aidan Bleser"
			class="size-full object-cover"
			width="96"
			height="96"
		/>
	</div>
	<blockquote
		class="font-display mt-8 text-2xl leading-snug font-semibold text-balance sm:text-3xl lg:text-4xl"
	>
		"I felt disincentivized from reading the code simply because the tools were so
		<span class="flame-text">bad.</span>"
	</blockquote>
	<p class="text-faint mt-5 text-sm">Aidan Bleser, building Super Review</p>
</div>
