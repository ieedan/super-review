<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Input } from '@super-review/ui/components/ui/input';
	import { Checkbox } from '@super-review/ui/components/ui/checkbox';
	import { Switch } from '@super-review/ui/components/ui/switch';
	import { Textarea } from '@super-review/ui/components/ui/textarea';

	// Grouped because these primitives are almost always used together on a form
	// (the Settings and Add-Repo dialogs, the commit box, etc.).
	const { Story } = defineMeta({
		title: 'UI/Form Controls'
	});
</script>

<Story name="Overview">
	{#snippet template()}
		<div class="flex w-80 flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<label class="text-sm font-medium" for="repo">Repository name</label>
				<Input id="repo" placeholder="acme/super-review" />
			</div>
			<div class="flex flex-col gap-1.5">
				<label class="text-sm font-medium" for="desc">Description</label>
				<Textarea id="desc" placeholder="What is this repo about?" />
			</div>
			<label class="flex items-center gap-2 text-sm">
				<Checkbox /> Sign commits
			</label>
			<label class="flex items-center gap-2 text-sm">
				<Switch /> Auto-remove merged branches
			</label>
		</div>
	{/snippet}
</Story>

<Story name="Input states">
	{#snippet template()}
		<div class="flex w-80 flex-col gap-3">
			<Input placeholder="Default" />
			<Input value="With a value" />
			<Input placeholder="Disabled" disabled />
			<Input placeholder="Invalid" aria-invalid="true" />
		</div>
	{/snippet}
</Story>

<Story name="Toggles">
	{#snippet template()}
		<div class="flex items-center gap-6">
			<label class="flex items-center gap-2 text-sm"><Checkbox checked /> Checked</label>
			<label class="flex items-center gap-2 text-sm"><Checkbox /> Unchecked</label>
			<label class="flex items-center gap-2 text-sm"><Switch checked /> On</label>
			<label class="flex items-center gap-2 text-sm"><Switch /> Off</label>
		</div>
	{/snippet}
</Story>
