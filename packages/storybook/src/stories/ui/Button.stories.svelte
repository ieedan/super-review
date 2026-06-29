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
