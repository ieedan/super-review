<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import {
		DropdownMenu,
		DropdownMenuTrigger,
		DropdownMenuContent,
		DropdownMenuGroup,
		DropdownMenuLabel,
		DropdownMenuItem,
		DropdownMenuCheckboxItem,
		DropdownMenuSeparator,
		DropdownMenuShortcut,
		DropdownMenuSub,
		DropdownMenuSubTrigger,
		DropdownMenuSubContent
	} from '@super-review/ui/components/ui/dropdown-menu';
	import { Button } from '@super-review/ui/components/ui/button';

	const { Story } = defineMeta({
		title: 'UI/Dropdown Menu',
		// The menu pops over the trigger; give it room so the open panel is visible
		// in the centered canvas.
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="flex min-h-72 items-start">
			<DropdownMenu>
				<DropdownMenuTrigger>
					{#snippet child({ props })}
						<Button variant="outline" {...props}>Open menu</Button>
					{/snippet}
				</DropdownMenuTrigger>
				<DropdownMenuContent class="w-56">
					<DropdownMenuLabel>Repository</DropdownMenuLabel>
					<DropdownMenuGroup>
						<DropdownMenuItem>
							Open in editor
							<DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
						</DropdownMenuItem>
						<DropdownMenuItem>
							Open in terminal
							<DropdownMenuShortcut>⌘T</DropdownMenuShortcut>
						</DropdownMenuItem>
						<DropdownMenuCheckboxItem checked>Show file icons</DropdownMenuCheckboxItem>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>Branch</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							<DropdownMenuItem>Switch branch</DropdownMenuItem>
							<DropdownMenuItem>Create branch</DropdownMenuItem>
							<DropdownMenuItem>Clean up branches</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive">Remove repository</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	{/snippet}
</Story>

<!-- Performance: a menu with a long item list (think a big branch switcher). -->
<Story name="Performance (400 items)">
	{#snippet template()}
		<div class="flex min-h-96 items-start">
			<DropdownMenu>
				<DropdownMenuTrigger>
					{#snippet child({ props })}
						<Button variant="outline" {...props}>400 branches</Button>
					{/snippet}
				</DropdownMenuTrigger>
				<DropdownMenuContent class="max-h-96 w-64 overflow-y-auto">
					{#each Array(400) as _, i (i)}
						<DropdownMenuItem>feat/topic-{i}</DropdownMenuItem>
					{/each}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	{/snippet}
</Story>
