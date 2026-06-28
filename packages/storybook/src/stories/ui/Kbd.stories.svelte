<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Kbd } from '@super-review/ui/components/ui/kbd';

	const { Story } = defineMeta({
		title: 'UI/Kbd',
		component: Kbd,
		tags: ['autodocs'],
		argTypes: {
			variant: { control: 'inline-radio', options: ['default', 'outline'] }
		},
		args: { variant: 'default' }
	});
</script>

<Story name="Playground">
	{#snippet template(args)}
		<Kbd {...args}>⌘K</Kbd>
	{/snippet}
</Story>

<Story name="Shortcuts">
	{#snippet template()}
		<div class="flex flex-col gap-3 text-sm">
			<div class="flex items-center gap-2">Command palette <Kbd>⌘</Kbd><Kbd>K</Kbd></div>
			<div class="flex items-center gap-2">Find in diff <Kbd>⌘</Kbd><Kbd>F</Kbd></div>
			<div class="flex items-center gap-2">Next file <Kbd variant="outline">J</Kbd></div>
			<div class="flex items-center gap-2">Previous file <Kbd variant="outline">K</Kbd></div>
		</div>
	{/snippet}
</Story>
