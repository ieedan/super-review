<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Button } from '@super-review/ui/components/ui/button';
	import type { ButtonSize, ButtonVariant } from '@super-review/ui/components/ui/button';

	const VARIANTS: ButtonVariant[] = [
		'default',
		'outline',
		'secondary',
		'ghost',
		'destructive',
		'link'
	];
	const SIZES: ButtonSize[] = ['xs', 'sm', 'default', 'lg'];

	const { Story } = defineMeta({
		title: 'UI/Button',
		component: Button,
		tags: ['autodocs'],
		argTypes: {
			variant: { control: 'select', options: VARIANTS },
			size: { control: 'select', options: SIZES },
			disabled: { control: 'boolean' }
		},
		args: {
			variant: 'default',
			size: 'default',
			disabled: false
		}
	});
</script>

<!-- Playground: tweak variant/size/disabled via the Controls panel. -->
<Story name="Playground">
	{#snippet template(args)}
		<Button {...args}>Review changes</Button>
	{/snippet}
</Story>

<Story name="Variants">
	{#snippet template()}
		<div class="flex flex-wrap items-center gap-3">
			{#each VARIANTS as variant (variant)}
				<Button {variant}>{variant}</Button>
			{/each}
		</div>
	{/snippet}
</Story>

<Story name="Sizes">
	{#snippet template()}
		<div class="flex flex-wrap items-center gap-3">
			{#each SIZES as size (size)}
				<Button {size}>Size {size}</Button>
			{/each}
		</div>
	{/snippet}
</Story>

<Story name="Disabled">
	{#snippet template()}
		<div class="flex flex-wrap items-center gap-3">
			{#each VARIANTS as variant (variant)}
				<Button {variant} disabled>{variant}</Button>
			{/each}
		</div>
	{/snippet}
</Story>

<!--
	Performance: a dense grid of every variant x size combination, repeated, to
	prove the button renders cheaply at scale (hover/focus transitions, the flame
	gradient and shadow all multiplied across hundreds of instances).
-->
<Story name="Performance (600 buttons)">
	{#snippet template()}
		<div class="grid max-w-5xl grid-cols-8 gap-2">
			{#each Array(600) as _, i (i)}
				<Button variant={VARIANTS[i % VARIANTS.length]} size={SIZES[i % SIZES.length]}>
					#{i}
				</Button>
			{/each}
		</div>
	{/snippet}
</Story>
