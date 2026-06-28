<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import {
		Dialog,
		DialogTrigger,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter
	} from '@super-review/ui/components/ui/dialog';
	import { Button } from '@super-review/ui/components/ui/button';
	import { Input } from '@super-review/ui/components/ui/input';

	const { Story } = defineMeta({
		title: 'UI/Dialog',
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Default">
	{#snippet template()}
		<Dialog>
			<DialogTrigger>
				{#snippet child({ props })}
					<Button {...props}>Create branch</Button>
				{/snippet}
			</DialogTrigger>
			<DialogContent class="w-[420px]">
				<DialogHeader>
					<DialogTitle>Create a branch</DialogTitle>
					<DialogDescription>
						Branch off the current HEAD. The new branch is checked out immediately.
					</DialogDescription>
				</DialogHeader>
				<div class="flex flex-col gap-1.5 py-2">
					<label class="text-sm font-medium" for="branch-name">Branch name</label>
					<Input id="branch-name" placeholder="feat/my-change" />
				</div>
				<DialogFooter>
					<Button variant="outline">Cancel</Button>
					<Button>Create branch</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	{/snippet}
</Story>
