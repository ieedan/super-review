<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '@super-review/ui/utils.js';
	import { useAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import { receive, send, useUnderlineTabsTrigger } from './underline-tabs.svelte.js';
	import { box } from 'svelte-toolbelt';

	// Gate the hover/active accent motion on the app's animation setting: when
	// accents are off, the crossfades collapse to 0ms and the opacity/color
	// transition classes drop, so the tab snaps instead of sliding.
	const animations = useAnimations();
	const hoverDuration = $derived(animations.accentsEnabled ? 300 : 0);
	const borderDuration = $derived(animations.accentsEnabled ? 200 : 0);

	let {
		ref = $bindable(null),
		value,
		class: className,
		onmouseenter,
		onmouseleave,
		onfocus,
		onblur,
		children,
		...restProps
	}: TabsPrimitive.TriggerProps = $props();

	const state = useUnderlineTabsTrigger({
		value: box.with(() => value),
		onmouseenter: box.with(() => onmouseenter),
		onmouseleave: box.with(() => onmouseleave),
		onfocus: box.with(() => onfocus),
		onblur: box.with(() => onblur)
	});
</script>

<div class="relative h-full">
	<TabsPrimitive.Trigger
		bind:ref
		data-slot="underline-tabs-trigger"
		class={cn(
			"dark:data-[state=active]:text-foreground data-[state=active]:text-foreground text-muted-foreground relative z-2 inline-flex h-[calc(100%-3px)] flex-1 items-center justify-center gap-1.5 px-3 py-1 text-sm font-medium whitespace-nowrap focus:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
			animations.accentsEnabled && 'transition-colors',
			state.rootState.isHovered &&
				state.rootState.hoveredTab === value &&
				'data-[state=inactive]:text-foreground!',
			className
		)}
		{...state.props}
		{...restProps}
	>
		{@render children?.()}
	</TabsPrimitive.Trigger>
	{#if state.rootState.hoveredTab === value}
		<div
			class={cn(
				'bg-accent absolute top-0 z-1 h-[calc(100%-3px)] w-full rounded-md opacity-0 peer-focus-visible:opacity-100',
				animations.accentsEnabled && 'transition-opacity duration-300',
				state.rootState.isHovered && 'opacity-100'
			)}
			in:receive={{ key: `${state.rootState.opts.id.current}-tab-hover`, duration: hoverDuration }}
			out:send={{ key: `${state.rootState.opts.id.current}-tab-hover`, duration: hoverDuration }}
		></div>
	{/if}
	{#if state.rootState.opts.value.current === value}
		<div
			class="bg-primary absolute -bottom-px z-1 h-0.5 w-full"
			in:receive={{
				key: `${state.rootState.opts.id.current}-tab-active-border`,
				duration: borderDuration
			}}
			out:send={{
				key: `${state.rootState.opts.id.current}-tab-active-border`,
				duration: borderDuration
			}}
		></div>
	{/if}
</div>
