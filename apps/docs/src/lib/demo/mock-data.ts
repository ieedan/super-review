import type { ChangedFile, DiffContext, DiffData, LocalComment } from '@super-review/core/types';

// ════════════════════════════════════════════════════════════════════════════
// DEMO DATA — the changeset the interactive demos display, modeled on a real PR:
// huntabyte/shadcn-svelte#2738 ("feat: heading anchors"). To show a different PR,
// edit CHANGES (and the wiring block at the bottom). Patches are generated for
// you, so you only write each file's before/after contents.
// ════════════════════════════════════════════════════════════════════════════

export const REPO = { id: 'shadcn-svelte', path: '/dev/shadcn-svelte', name: 'shadcn-svelte' };
export const CTX: DiffContext = { kind: 'workingTree' };

type Change = {
	path: string;
	status?: ChangedFile['status']; // defaults to 'modified'; 'added' ⇒ old: ''
	old: string;
	new: string;
};

const MDSX = 'docs/src/lib/components/mdsx';

const CHANGES: Change[] = [
	// The new component at the heart of the PR.
	{
		path: `${MDSX}/heading-anchor.svelte`,
		status: 'added',
		old: '',
		new: `<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		id,
		children,
	}: {
		id?: string;
		children?: Snippet;
	} = $props();
</script>

{#if id}
	<a class="group no-underline" href={\`#\${id}\`}>
		<span class="underline-offset-4 group-hover:underline">
			{@render children?.()}
		</span>
		<span
			aria-hidden="true"
			class="text-muted-foreground ml-2 opacity-0 group-hover:opacity-100"
		>
			#
		</span>
	</a>
{:else}
	{@render children?.()}
{/if}
`
	},
	// h1: wrap the heading content in the new anchor.
	{
		path: `${MDSX}/h1.svelte`,
		old: `<script lang="ts">
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLHeadingElement> = $props();
</script>

<h1
	class={cn("font-heading mt-2 scroll-m-28 text-4xl font-bold tracking-tight", className)}
	{...restProps}
>
	{@render children?.()}
</h1>
`,
		new: `<script lang="ts">
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import HeadingAnchor from "./heading-anchor.svelte";

	let {
		class: className,
		children,
		id,
		...restProps
	}: HTMLAttributes<HTMLHeadingElement> = $props();
</script>

<h1
	class={cn("font-heading mt-2 scroll-m-28 text-4xl font-bold tracking-tight", className)}
	{id}
	{...restProps}
>
	<HeadingAnchor id={id ?? undefined}>
		{@render children?.()}
	</HeadingAnchor>
</h1>
`
	},
	// h2: the anchor wrap PLUS the lg:mt-16 → lg:mt-12 height change ieedan flagged.
	{
		path: `${MDSX}/h2.svelte`,
		old: `<script lang="ts">
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLHeadingElement> = $props();
</script>

<h2
	class={cn(
		"font-heading [&+]*:[code]:text-xl mt-10 scroll-m-28 text-xl font-medium tracking-tight first:mt-0 lg:mt-16 [&+.steps]:!mt-0 [&+.steps>h3]:!mt-4 [&+h3]:!mt-6 [&+p]:!mt-4",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</h2>
`,
		new: `<script lang="ts">
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import HeadingAnchor from "./heading-anchor.svelte";

	let {
		class: className,
		children,
		id,
		...restProps
	}: HTMLAttributes<HTMLHeadingElement> = $props();
</script>

<h2
	class={cn(
		"[&+]*:[code]:text-xl font-heading mt-10 scroll-m-28 text-xl font-medium tracking-tight first:mt-0 lg:mt-12 [&+.steps]:!mt-0 [&+.steps>h3]:!mt-4 [&+h3]:!mt-6 [&+p]:!mt-4",
		className
	)}
	{id}
	{...restProps}
>
	<HeadingAnchor id={id ?? undefined}>
		{@render children?.()}
	</HeadingAnchor>
</h2>
`
	},
	// h3: same anchor wrap.
	{
		path: `${MDSX}/h3.svelte`,
		old: `<script lang="ts">
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let { class: className, children, ...restProps }: HTMLAttributes<HTMLHeadingElement> = $props();
</script>

<h3
	class={cn(
		"font-heading mt-8 scroll-m-28 text-lg font-medium tracking-tight [&+p]:!mt-4",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</h3>
`,
		new: `<script lang="ts">
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";
	import HeadingAnchor from "./heading-anchor.svelte";

	let {
		class: className,
		children,
		id,
		...restProps
	}: HTMLAttributes<HTMLHeadingElement> = $props();
</script>

<h3
	class={cn(
		"font-heading mt-8 scroll-m-28 text-lg font-medium tracking-tight [&+p]:!mt-4",
		className
	)}
	{id}
	{...restProps}
>
	<HeadingAnchor id={id ?? undefined}>
		{@render children?.()}
	</HeadingAnchor>
</h3>
`
	},
	// p: tweak the line-height utility.
	{
		path: `${MDSX}/p.svelte`,
		old: `<script lang="ts">
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLParagraphElement> = $props();
</script>

<p class={cn("leading-[1.65rem] [&:not(:first-child)]:mt-6", className)} {...restProps}>
	{@render children?.()}
</p>
`,
		new: `<script lang="ts">
	import { cn } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		class: className,
		children,
		...restProps
	}: HTMLAttributes<HTMLParagraphElement> = $props();
</script>

<p class={cn("leading-relaxed [&:not(:first-child)]:mt-6", className)} {...restProps}>
	{@render children?.()}
</p>
`
	},
	// app.css: drop scroll-smooth from the base layer.
	{
		path: 'docs/src/app.css',
		old: `@layer base {
	* {
		@apply border-border;
	}

	html {
		@apply overscroll-none scroll-smooth;
	}

	body {
		@apply bg-background text-foreground;
	}
}
`,
		new: `@layer base {
	* {
		@apply border-border;
	}

	html {
		@apply overscroll-none;
	}

	body {
		@apply bg-background text-foreground;
	}
}
`
	}
];

// ── Patch generation ────────────────────────────────────────────────────────
// A correct single-hunk unified patch from old→new via an LCS diff, so we never
// hand-count hunk headers. Pierre renders from old/new contents; the patch drives
// line anchoring + the staging gutter.
function lines(text: string): string[] {
	if (text === '') return [];
	return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
}

function makeDiff(c: Change): DiffData {
	const status = c.status ?? 'modified';
	const a = lines(c.old);
	const b = lines(c.new);
	const n = a.length;
	const m = b.length;

	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const body: string[] = [];
	let additions = 0;
	let deletions = 0;
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			body.push(' ' + a[i++]);
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			body.push('-' + a[i++]);
			deletions++;
		} else {
			body.push('+' + b[j++]);
			additions++;
		}
	}
	while (i < n) {
		body.push('-' + a[i++]);
		deletions++;
	}
	while (j < m) {
		body.push('+' + b[j++]);
		additions++;
	}

	const patch = `@@ -${n === 0 ? 0 : 1},${n} +${m === 0 ? 0 : 1},${m} @@\n${body.join('\n')}\n`;
	return {
		file: { path: c.path, status, additions, deletions, isBinary: false },
		oldContents: c.old,
		newContents: c.new,
		patch,
		truncated: false
	};
}

export const MOCK_DIFFS: DiffData[] = CHANGES.map(makeDiff);
export const MOCK_FILES: ChangedFile[] = MOCK_DIFFS.map((d) => d.file);

// ── Demo wiring ─────────────────────────────────────────────────────────────
// Which files each section shows, the file that opens already-reviewed, and the
// (real) review comment ieedan left on the PR. Change these to re-aim the demos.
export const SEEN_FILE = `${MDSX}/p.svelte`;
export const MARK_AS_SEEN_FILES = [SEEN_FILE, 'docs/src/app.css', `${MDSX}/h3.svelte`];
export const COMMENTS_FILE = `${MDSX}/h2.svelte`;

// ieedan's actual review comment on the PR, anchored to the lg:mt-12 height change.
export const SEED_COMMENT: Omit<LocalComment, 'createdAt' | 'updatedAt'> & { ageMs: number } = {
	id: 'demo-seed-1',
	contextKey: 'workingTree',
	path: COMMENTS_FILE,
	side: 'RIGHT',
	startLine: 16,
	endLine: 16,
	body: `So the height changes made here are fine but I think if we are going to make them we need to also update our examples.

A lot of the examples like aspect-ratio, alert etc. no longer fit in this new height restriction.

That's definitely a larger change though so maybe we should move those changes to a separate PR and just do the external link badges in this PR?`,
	author: { kind: 'human', name: 'ieedan', avatarUrl: 'https://github.com/ieedan.png' },
	ageMs: 18 * 60 * 1000
};
