<script lang="ts">
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';
	import WaitlistForm from '$lib/components/WaitlistForm.svelte';
	import { MARK_AS_SEEN_FILES, COMMENTS_FILE, SEED_COMMENT } from '$lib/demo/mock-data';

	// Real product screenshot in static/.
	const screenshot: string | null = '/app-preview.webp';

	// The header CTA drops the visitor straight into the hero's email field.
	function focusWaitlist(): void {
		const el = document.querySelector<HTMLInputElement>('#waitlist input');
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		el?.focus({ preventScroll: true });
	}

	// The interactive demos embed the real desktop components, whose module graph
	// (Pierre, a syntax highlighter, DOMPurify) can't be server-rendered. Load them
	// only in the browser so SSR/prerender stays clean and the hero still SSRs.
	let DemoSidebar = $state<Component | null>(null);
	let DemoDiff = $state<Component<{ paths?: string[]; class?: string }> | null>(null);
	onMount(async () => {
		const [sidebar, diff] = await Promise.all([
			import('$lib/components/DemoSidebar.svelte'),
			import('$lib/components/DemoDiff.svelte')
		]);
		DemoSidebar = sidebar.default;
		DemoDiff = diff.default;
	});
</script>

<svelte:head>
	<title>Super Review: a faster, saner way to review agent-written code</title>
	<meta
		name="description"
		content="Super Review is a git client built for actually reviewing massive, agent-written PRs."
	/>
	<link rel="canonical" href="https://superreview.dev/" />

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Super Review" />
	<meta property="og:url" content="https://superreview.dev/" />
	<meta property="og:title" content="Super Review: review agent-written code" />
	<meta
		property="og:description"
		content="A git client built for actually reviewing massive, agent-written PRs."
	/>
	<meta property="og:image" content="https://superreview.dev/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta
		property="og:image:alt"
		content="Super Review: a faster, saner way to review agent-written code"
	/>

	<!-- Twitter / X -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Super Review: review agent-written code" />
	<meta
		name="twitter:description"
		content="A git client built for actually reviewing massive, agent-written PRs."
	/>
	<meta name="twitter:image" content="https://superreview.dev/og.png" />
</svelte:head>

<div class="atmosphere"><div class="grid-bg"></div></div>
<div class="grain"></div>

<div class="relative z-10 mx-auto max-w-6xl px-6">
	<!-- Nav -->
	<header class="flex items-center justify-between py-5">
		<a href="/" class="flex items-center gap-2.5">
			<img src="/icon.png" alt="" class="h-8 w-8 rounded-lg shadow-lg" />
			<span class="font-display text-lg font-bold tracking-tight">Super Review</span>
		</a>
		<button
			type="button"
			onclick={focusWaitlist}
			class="border-line text-muted-foreground hover:text-fg inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors"
		>
			<span class="bg-flame h-1.5 w-1.5 animate-pulse rounded-full"></span>
			Join the waitlist
		</button>
	</header>

	<!-- ── Hero ──────────────────────────────────────────────────────────────── -->
	<main class="flex flex-col items-center pt-16 text-center sm:pt-24">
		<h1
			class="reveal font-display max-w-3xl text-5xl leading-[1.03] font-extrabold tracking-tight text-balance sm:text-6xl"
			style="animation-delay: 40ms"
		>
			A faster, saner way to review
			<span class="flame-text">agent-written code.</span>
		</h1>

		<p
			class="reveal text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed text-pretty"
			style="animation-delay: 160ms"
		>
			Super Review is a git client built for actually reviewing massive, agent-written PRs.
		</p>

		<!-- Waitlist -->
		<div
			id="waitlist"
			class="reveal mt-9 w-full max-w-md scroll-mt-24"
			style="animation-delay: 240ms"
		>
			<WaitlistForm />
		</div>

		<!-- App preview -->
		<div class="reveal mt-16 w-full max-w-5xl pb-20" style="animation-delay: 320ms">
			<div
				class="pointer-events-none absolute left-1/2 -z-10 h-72 w-[80%] -translate-x-1/2 opacity-60"
				style="background: radial-gradient(50% 60% at 50% 40%, hsl(11 100% 60% / 0.22), transparent 70%); filter: blur(30px);"
			></div>

			<div
				class="border-line overflow-hidden rounded-2xl border text-left shadow-2xl backdrop-blur-sm"
				style="box-shadow: 0 50px 120px -40px hsl(6 88% 40% / 0.5);"
			>
				{#if screenshot}
					<img src={screenshot} alt="Super Review app preview" class="block w-full" />
				{/if}
			</div>
		</div>
	</main>

	<!-- ── Section: read & review ────────────────────────────────────────────── -->
	<section class="flex flex-col items-center pt-8 pb-20">
		<!-- Pull quote -->
		<div
			class="reveal flex max-w-2xl flex-col items-center text-center"
			style="animation-delay: 480ms"
		>
			<div class="ring-line bg-elevated size-14 overflow-hidden rounded-full ring-1">
				<img
					src="https://github.com/ieedan.png"
					alt="Aidan Bleser"
					class="size-full object-cover"
					width="56"
					height="56"
				/>
			</div>
			<blockquote
				class="font-display mt-6 text-2xl leading-snug font-semibold text-balance sm:text-3xl"
			>
				"I felt disincentivized from reading the code simply because the tools were so
				<span class="flame-text">bad.</span>"
			</blockquote>
			<p class="text-faint mt-4 text-sm">Aidan Bleser, building Super Review</p>
		</div>

		<h2
			class="reveal font-display mt-20 max-w-2xl text-center text-3xl font-extrabold tracking-tight text-balance sm:text-4xl"
			style="animation-delay: 580ms"
		>
			Super Review helps you read and review the code.
		</h2>
		<p
			class="reveal text-muted-foreground mt-4 max-w-lg text-center text-base"
			style="animation-delay: 660ms"
		>
			With sensible UX choices that you can feel the entire way through.
		</p>

		<!-- Features: staggered text + live demo, alternating sides on wide screens. The
		     demo column is fixed-width so the diff header stays wide enough to show the
		     real "Mark seen" control (it hides below 500px). -->
		<div class="mt-16 flex w-full flex-col gap-20 sm:gap-24">
			<!-- Feature 1: organize (demo right) -->
			<div class="flex flex-col items-center gap-8 lg:flex-row lg:gap-12">
				<div class="reveal flex-1 text-center lg:text-left" style="animation-delay: 760ms">
					<h3 class="font-display text-2xl font-bold tracking-tight">Organize your changes</h3>
					<p class="text-muted-foreground mt-3 text-base leading-relaxed text-pretty">
						View your changes in a list or file tree and switch instantly, at any time.
					</p>
				</div>
				<div
					class="reveal w-full lg:w-[600px] lg:shrink-0"
					style="animation-delay: 860ms"
				>
					{#if DemoSidebar}<DemoSidebar />{:else}{@render placeholder()}{/if}
				</div>
			</div>

			<!-- Feature 2: mark as seen (demo left) -->
			<div class="flex flex-col items-center gap-8 lg:flex-row-reverse lg:gap-12">
				<div class="reveal flex-1 text-center lg:text-right" style="animation-delay: 960ms">
					<h3 class="font-display text-2xl font-bold tracking-tight">Mark changes as seen</h3>
					<p class="text-muted-foreground mt-3 text-base leading-relaxed text-pretty">
						Mark a change as seen and move on. Reviewed files collapse and get out of your way, so
						you always know exactly what is left.
					</p>
				</div>
				<div
					class="reveal w-full lg:w-[600px] lg:shrink-0"
					style="animation-delay: 1060ms"
				>
					{#if DemoDiff}
						<DemoDiff paths={MARK_AS_SEEN_FILES} />
					{:else}{@render placeholder()}{/if}
				</div>
			</div>

			<!-- Feature 3: comments (demo right) -->
			<div class="flex flex-col items-center gap-8 lg:flex-row lg:gap-12">
				<div class="reveal flex-1 text-center lg:text-left" style="animation-delay: 1160ms">
					<h3 class="font-display text-2xl font-bold tracking-tight">Write your comments</h3>
					<p class="text-muted-foreground mt-3 text-base leading-relaxed text-pretty">
						Click any line to leave a comment, then copy it in one click to hand straight to your
						agent.
					</p>
				</div>
				<div
					class="reveal w-full lg:w-[600px] lg:shrink-0"
					style="animation-delay: 1260ms"
				>
					{#if DemoDiff}
						<DemoDiff paths={[COMMENTS_FILE]} focusCommentId={SEED_COMMENT.id} />
					{:else}{@render placeholder()}{/if}
				</div>
			</div>
		</div>
	</section>

	<!-- Bottom CTA -->
	<section class="reveal flex flex-col items-center pb-24 text-center" style="animation-delay: 1360ms">
		<h2 class="font-display max-w-xl text-3xl font-extrabold tracking-tight text-balance">
			Be the first to <span class="flame-text">try it.</span>
		</h2>
		<div class="mt-7 w-full max-w-md">
			<WaitlistForm />
		</div>
	</section>

	<!-- Footer -->
	<footer
		class="border-line text-faint flex flex-col items-center justify-between gap-4 border-t py-8 text-sm sm:flex-row"
	>
		<div class="flex items-center gap-2.5">
			<img src="/icon.png" alt="" class="h-6 w-6 rounded-md" />
			<span>Super Review</span>
		</div>
		<span>&copy; {new Date().getFullYear()} Super Review</span>
	</footer>
</div>

<!-- Server-render placeholder for the client-only interactive demos. -->
{#snippet placeholder()}
	<div class="h-[440px] rounded-xl border border-border bg-background"></div>
{/snippet}
