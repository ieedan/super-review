<script lang="ts">
	let {
		size = 'md',
		class: className = ''
	}: {
		size?: 'sm' | 'md';
		class?: string;
	} = $props();

	const iconClass = $derived(size === 'sm' ? 'h-6 w-6 rounded-md' : 'h-8 w-8 rounded-lg shadow-lg');
	const textClass = $derived(
		size === 'sm'
			? 'font-display text-sm font-bold tracking-tight'
			: 'font-display text-lg font-bold tracking-tight'
	);
</script>

<div class="flex items-center gap-2.5 {className}">
	<img src="/icon.png" alt="" class={iconClass} />
	<span class={textClass}>Super Review</span>
</div>
