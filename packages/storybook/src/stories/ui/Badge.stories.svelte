<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Badge } from '@super-review/ui/components/ui/badge';
	import type { BadgeVariant } from '@super-review/ui/components/ui/badge';

	const VARIANTS: BadgeVariant[] = [
		'default',
		'secondary',
		'destructive',
		'outline',
		'ghost',
		'link',
		'success',
		'warning',
		'muted'
	];

	const { Story } = defineMeta({
		title: 'UI/Badge',
		component: Badge,
		tags: ['autodocs'],
		argTypes: {
			variant: { control: 'select', options: VARIANTS }
		},
		args: { variant: 'default' }
	});
</script>

<Story name="Playground">
	{#snippet template(args)}
		<Badge {...args}>Badge</Badge>
	{/snippet}
</Story>

<Story name="Variants">
	{#snippet template()}
		<div class="flex flex-wrap items-center gap-2">
			{#each VARIANTS as variant (variant)}
				<Badge {variant}>{variant}</Badge>
			{/each}
		</div>
	{/snippet}
</Story>
