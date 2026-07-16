<script lang="ts">
	let {
		title,
		description,
		class: className = '',
		titleClass = 'mt-20 max-w-2xl text-center text-3xl sm:text-4xl',
		descriptionClass = 'mt-4 max-w-lg text-center text-base',
		animationDelay,
		descriptionDelay
	}: {
		title: string;
		description?: string;
		class?: string;
		titleClass?: string;
		descriptionClass?: string;
		animationDelay?: string;
		descriptionDelay?: string;
	} = $props();
</script>

<div class={className}>
	<h2
		class="reveal font-display font-extrabold tracking-tight text-balance {titleClass}"
		style={animationDelay ? `animation-delay: ${animationDelay}` : undefined}
	>
		{title}
	</h2>
	{#if description}
		<p
			class="reveal text-muted-foreground {descriptionClass}"
			style={descriptionDelay ? `animation-delay: ${descriptionDelay}` : undefined}
		>
			{description}
		</p>
	{/if}
</div>
