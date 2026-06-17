<script lang="ts">
	import { Command as CommandPrimitive } from 'bits-ui';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Search from '@lucide/svelte/icons/search';
	import { buttonVariants } from './ui/button';
	import * as Popover from './ui/popover';
	import * as Command from './ui/command';
	import { app } from '$lib/store.svelte';
	import { cn } from '$lib/utils';

	interface Props {
		// 'system' for the default stack, otherwise an installed family name.
		value: string;
		onChange: (font: string) => void;
		// Append a monospace fallback to each option's preview so proportional
		// metrics don't distort the code-font list.
		mono?: boolean;
	}

	let { value, onChange, mono = false }: Props = $props();

	let open = $state(false);
	let filter = $state('');

	const label = $derived(value === 'system' ? 'System default' : value);

	function previewStyle(font: string): string {
		return `font-family: "${font}"${mono ? ', monospace' : ''}`;
	}

	function pick(font: string): void {
		open = false;
		onChange(font);
	}
</script>

<Popover.Root
	bind:open
	onOpenChange={(v) => {
		if (!v) filter = '';
	}}
>
	<Popover.Trigger
		class={cn(
			buttonVariants({ variant: 'outline', size: 'sm' }),
			'w-full justify-between font-normal'
		)}
	>
		<span class="truncate" style={value === 'system' ? '' : previewStyle(value)}>
			{label}
		</span>
		<ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
	</Popover.Trigger>
	<Popover.Content align="start" class="w-[20rem] p-0">
		<Command.Root shouldFilter={true}>
			<div class="flex items-center gap-2 border-b border-border p-2">
				<div
					class="flex h-8 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2"
				>
					<Search class="size-3.5 shrink-0 text-muted-foreground" />
					<CommandPrimitive.Input
						bind:value={filter}
						placeholder="Search fonts…"
						class="flex h-full w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
					/>
				</div>
			</div>

			<Command.List class="max-h-[260px]">
				<Command.Empty>No fonts found</Command.Empty>
				<Command.Item
					value="system default"
					onSelect={() => pick('system')}
					class="flex items-center gap-2"
				>
					<Check class={cn('size-3.5', value === 'system' ? 'opacity-100' : 'opacity-0')} />
					<span class="flex-1 truncate">System default</span>
				</Command.Item>
				{#if app.systemFonts.length > 0}
					<Command.Separator />
					{#each app.systemFonts as font (font)}
						<Command.Item value={font} onSelect={() => pick(font)} class="flex items-center gap-2">
							<Check class={cn('size-3.5', value === font ? 'opacity-100' : 'opacity-0')} />
							<span class="flex-1 truncate" style={previewStyle(font)}>{font}</span>
						</Command.Item>
					{/each}
				{/if}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
