<script lang="ts">
	import { ChevronDown, ChevronUp, X, CaseSensitive } from 'lucide-svelte';
	import { Button } from './ui/button';
	import { cn } from '$lib/utils';
	import {
		find,
		setQuery,
		nextMatch,
		prevMatch,
		closeFind,
		toggleCaseSensitive
	} from '$lib/diff-find.svelte';

	let inputEl = $state<HTMLInputElement | null>(null);

	// When the bar opens (or re-opens with content already in it), grab focus
	// and select the existing query so the next keystroke replaces it — same
	// behavior as DevTools / VSCode find. `focusNonce` is bumped on every
	// openFind() call so a repeat Cmd+F also re-focuses, not just the first.
	$effect(() => {
		// Read both so Svelte registers them as dependencies.
		void find.focusNonce;
		if (!find.open) return;
		queueMicrotask(() => {
			inputEl?.focus();
			inputEl?.select();
		});
	});

	function onInput(e: Event): void {
		const value = (e.target as HTMLInputElement).value;
		setQuery(value);
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeFind();
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (e.shiftKey) prevMatch();
			else nextMatch();
			return;
		}
	}

	const counterText = $derived.by(() => {
		if (!find.query) return '';
		if (find.matchCount === 0) return 'No results';
		const current = find.currentIndex < 0 ? 0 : find.currentIndex + 1;
		return `${current} of ${find.matchCount}`;
	});
</script>

{#if find.open}
	<!-- Floating bar pinned to the top-right of the diff scroll area. Sits over
       the sticky file headers but below dialogs / popovers (z-20). -->
	<div
		class="pointer-events-auto absolute top-2 right-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-lg backdrop-blur"
		role="search"
	>
		<input
			bind:this={inputEl}
			type="text"
			value={find.query}
			oninput={onInput}
			onkeydown={onKeydown}
			placeholder="Find in changes…"
			aria-label="Find in changes"
			class="h-7 w-56 bg-transparent px-2 text-xs outline-hidden placeholder:text-muted-foreground"
		/>
		<span
			class={cn(
				'min-w-[68px] px-1 text-right text-[10px] tabular-nums',
				find.query && find.matchCount === 0 ? 'text-destructive' : 'text-muted-foreground'
			)}
		>
			{counterText}
		</span>
		<Button
			variant={find.caseSensitive ? 'secondary' : 'ghost'}
			size="icon-xs"
			title="Match case"
			onclick={toggleCaseSensitive}
		>
			<CaseSensitive class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			title="Previous match (Shift+Enter)"
			onclick={prevMatch}
			disabled={find.matchCount === 0}
		>
			<ChevronUp class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			title="Next match (Enter)"
			onclick={nextMatch}
			disabled={find.matchCount === 0}
		>
			<ChevronDown class="size-3.5" />
		</Button>
		<Button variant="ghost" size="icon-xs" title="Close (Esc)" onclick={closeFind}>
			<X class="size-3.5" />
		</Button>
	</div>
{/if}
