<script lang="ts">
	import * as Popover from './ui/popover';
	import * as Tooltip from './ui/tooltip';
	import { actions } from '@super-review/ui/store.svelte';
	import type { SymbolLens, SymbolRefLocation } from '@super-review/core/types';

	// A "used in N places" lens, mounted by DiffFileSection on the line above a
	// declaration in the Raw view. A count of zero is the signal worth noticing, so
	// only that case gets the warning color; counts that can't be trusted say so
	// instead of passing for exact.
	let { symbol }: { symbol: SymbolLens } = $props();

	const places = (n: number): string => (n === 1 ? '1 place' : `${n} places`);

	const unused = $derived(symbol.count === 0 && symbol.confidence === 'exact');
	const unknown = $derived(symbol.count === 0 && symbol.confidence === 'atLeast');

	const label = $derived.by(() => {
		if (unknown) return 'usage unknown';
		if (symbol.confidence === 'atLeast') return `used in ${symbol.count}+ places`;
		if (symbol.confidence === 'approximate') return `used in ~${places(symbol.count)}`;
		return `used in ${places(symbol.count)}`;
	});

	// What the reader should know before trusting the number.
	const caveat = $derived.by(() => {
		if (symbol.confidence === 'approximate') {
			return 'The name is also used for something else in a file that uses it, so this may be a little high.';
		}
		if (symbol.confidence === 'atLeast') {
			return symbol.uncertainty ?? 'Some uses could not be followed, so there may be more.';
		}
		return null;
	});

	let open = $state(false);

	function openLocation(loc: SymbolRefLocation): void {
		open = false;
		void actions.openInEditor(loc.path, loc.line);
	}

	// Split `dir/file.ts` so the file name stays readable when the path is cut.
	function splitPath(p: string): { dir: string; name: string } {
		const i = p.lastIndexOf('/');
		return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
	}
</script>

<div class="flex h-[18px] items-center pl-3 font-sans text-[11px] leading-none select-none">
	<Tooltip.Provider delayDuration={200}>
		<Tooltip.Root disabled={!caveat}>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					{#if symbol.count > 0}
						<Popover.Root bind:open>
							<Popover.Trigger
								{...props}
								class="cursor-pointer rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
							>
								{label}
							</Popover.Trigger>
							<Popover.Content
								align="start"
								class="w-[28rem] max-w-[90vw] gap-0 p-0"
								onOpenAutoFocus={(e) => e.preventDefault()}
							>
								<div class="border-b border-border px-3 py-2 text-xs font-medium">
									<span class="font-mono">{symbol.name}</span>
									<span class="font-normal text-muted-foreground">
										is used in {symbol.confidence === 'atLeast' ? 'at least ' : ''}{places(
											symbol.count
										)}
									</span>
									{#if caveat}
										<p class="mt-1 text-[11px] font-normal text-muted-foreground">{caveat}</p>
									{/if}
								</div>
								<ul class="max-h-72 overflow-y-auto py-1">
									{#each symbol.locations as loc, i (`${loc.path}:${loc.line}:${loc.col}:${i}`)}
										{@const parts = splitPath(loc.path)}
										<li>
											<button
												type="button"
												class="flex w-full cursor-pointer flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
												onclick={() => openLocation(loc)}
											>
												<span class="flex min-w-0 items-baseline text-xs">
													<span class="min-w-0 truncate text-muted-foreground" dir="rtl">
														<bdi>{parts.dir}</bdi>
													</span>
													<span class="shrink-0 font-medium">{parts.name}</span>
													<span class="shrink-0 text-muted-foreground tabular-nums"
														>:{loc.line}</span
													>
												</span>
												{#if loc.text}
													<span class="truncate font-mono text-[11px] text-muted-foreground"
														>{loc.text}</span
													>
												{/if}
											</button>
										</li>
									{/each}
								</ul>
								{#if symbol.locationsTruncated}
									<div class="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
										Showing the first {symbol.locations.length}.
									</div>
								{/if}
							</Popover.Content>
						</Popover.Root>
					{:else}
						<span {...props} class={unused ? 'text-amber-500' : 'text-muted-foreground'}
							>{label}</span
						>
					{/if}
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="top">{caveat}</Tooltip.Content>
		</Tooltip.Root>
	</Tooltip.Provider>
</div>
