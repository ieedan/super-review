<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import {
		Tooltip,
		TooltipProvider,
		TooltipTrigger,
		TooltipContent
	} from '@super-review/ui/components/ui/tooltip';
	import { Button } from '@super-review/ui/components/ui/button';

	const { Story } = defineMeta({
		title: 'UI/Tooltip',
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="flex min-h-40 items-center justify-center">
			<TooltipProvider delayDuration={150}>
				<Tooltip>
					<TooltipTrigger>
						{#snippet child({ props })}
							<Button variant="outline" {...props}>Hover me</Button>
						{/snippet}
					</TooltipTrigger>
					<TooltipContent
						side="top"
						class="border border-border bg-popover text-popover-foreground shadow-md"
						arrowClasses="bg-popover fill-popover"
					>
						Mark this file as seen
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	{/snippet}
</Story>

<Story name="Sides">
	{#snippet template()}
		<div class="grid min-h-60 grid-cols-2 place-items-center gap-8">
			{#each ['top', 'right', 'bottom', 'left'] as const as side (side)}
				<TooltipProvider delayDuration={100}>
					<Tooltip>
						<TooltipTrigger>
							{#snippet child({ props })}
								<Button variant="outline" {...props}>{side}</Button>
							{/snippet}
						</TooltipTrigger>
						<TooltipContent
							{side}
							class="border border-border bg-popover text-popover-foreground shadow-md"
							arrowClasses="bg-popover fill-popover"
						>
							Tooltip on {side}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			{/each}
		</div>
	{/snippet}
</Story>
