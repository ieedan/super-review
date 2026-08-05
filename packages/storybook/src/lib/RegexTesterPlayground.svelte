<script lang="ts">
	// A standalone bench for the regex tester popup, without a diff in the way.
	// The real feature is driven by @pierre/diffs token events inside a shadow
	// root (see the "In a diff" stories); this stands in for those events with
	// plain spans, so every state the popup can reach is one click away.

	import RegexTesterPopup from '@super-review/ui/components/RegexTesterPopup.svelte';
	import {
		showRegexHint,
		scheduleHideRegexHint,
		toggleRegexTester
	} from '@super-review/ui/regex-tester.svelte';
	import { parseRegexLiterals } from '@super-review/ui/regex-literals';

	// Each line is scanned with the real detector, so what the bench offers is
	// exactly what the diff would find in the same source.
	const LINES = [
		{ code: 'const EMAIL = /^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i;', note: 'try  a@b.com' },
		{ code: 'const words = text.match(/\\b\\w+\\b/g);', note: 'global: every match highlights' },
		{ code: 'const SEMVER = /^(\\d+)\\.(\\d+)\\.(\\d+)$/;', note: 'try  1.4.12' },
		{ code: 'const SEP = /[/\\\\]+/g;', note: 'a slash inside a character class' },
		{ code: 'const EMPTY = /a*/g;', note: 'can match the empty string' },
		{ code: 'const BROKEN = /(unclosed/;', note: 'does not compile: error state' }
	];

	// Line number is 1-based to match the detector's index, and each bench line
	// is its own "file" of one line.
	const rows = LINES.map((line, i) => {
		const span = parseRegexLiterals(line.code).get(1)?.[0] ?? null;
		return {
			...line,
			span,
			before: span ? line.code.slice(0, span.startCol) : line.code,
			after: span ? line.code.slice(span.endCol) : '',
			key: `bench:${i}`
		};
	});

	let container = $state<HTMLElement | null>(null);
</script>

<div bind:this={container} class="flex flex-col gap-1 p-6 font-mono text-xs">
	<p class="mb-3 font-sans text-sm text-muted-foreground">
		Hover a highlighted literal for the hint, then click it to open the tester. Escape, an outside
		click, or clicking the literal again closes it.
	</p>
	{#each rows as row (row.key)}
		<div class="flex items-baseline gap-4">
			<code class="text-foreground/90">
				{row.before}{#if row.span}<span
						role="button"
						tabindex="0"
						class="cursor-pointer"
						onpointerenter={(e) =>
							showRegexHint([e.currentTarget], container, { ...row.span!, key: row.key })}
						onpointerleave={() => scheduleHideRegexHint()}
						onclick={(e) =>
							toggleRegexTester([e.currentTarget], container, { ...row.span!, key: row.key })}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								toggleRegexTester([e.currentTarget], container, { ...row.span!, key: row.key });
							}
						}}>{row.span.source}</span
					>{/if}{row.after}
			</code>
			<span class="font-sans text-[11px] text-muted-foreground">{row.note}</span>
		</div>
	{/each}
</div>

<RegexTesterPopup />
