<script lang="ts">
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';
	import Header from '$lib/components/Header.svelte';
	import Hero from '$lib/components/Hero.svelte';
	import AgentReadySection from '$lib/components/AgentReadySection.svelte';
	import PullQuote from '$lib/components/PullQuote.svelte';
	import SectionHeading from '$lib/components/SectionHeading.svelte';
	import FeatureSection from '$lib/components/FeatureSection.svelte';
	import BottomCta from '$lib/components/BottomCta.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import DemoPlaceholder from '$lib/components/DemoPlaceholder.svelte';
	import { MARK_AS_SEEN_FILES, COMMENTS_FILE, SEED_COMMENT } from '$lib/demo/mock-data';

	// The interactive demos embed the real desktop components, whose module graph
	// (Pierre, a syntax highlighter, DOMPurify) can't be server-rendered. Load them
	// only in the browser so SSR/prerender stays clean and the hero still SSRs.
	let DemoSidebar = $state<Component | null>(null);
	let DemoDiff = $state<Component<{
		paths?: string[];
		class?: string;
		focusCommentId?: string;
	}> | null>(null);
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
	<title>Super Review: code review for the agentic era</title>
	<meta
		name="description"
		content="Super Review is a git client built for actually reviewing massive, agent-written PRs."
	/>
	<link rel="canonical" href="https://superreview.dev/" />

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Super Review" />
	<meta property="og:url" content="https://superreview.dev/" />
	<meta property="og:title" content="Super Review: code review for the agentic era" />
	<meta
		property="og:description"
		content="A git client built for actually reviewing massive, agent-written PRs."
	/>
	<meta property="og:image" content="https://superreview.dev/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta
		property="og:image:alt"
		content="Super Review: code review for the agentic era"
	/>

	<!-- Twitter / X -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Super Review: code review for the agentic era" />
	<meta
		name="twitter:description"
		content="A git client built for actually reviewing massive, agent-written PRs."
	/>
	<meta name="twitter:image" content="https://superreview.dev/og.png" />
</svelte:head>

<div class="relative z-10 mx-auto max-w-6xl px-4 sm:px-6">
	<Header />

	<Hero />
	<AgentReadySection />

	<div class="flex flex-col items-center">
		<PullQuote />
	</div>

	<section class="border-line flex flex-col items-center border-t pb-20 pt-16">
		<SectionHeading
			title="Super Review makes it possible to actually read the code."
			description="With sensible UX choices that you can feel the entire way through."
			animationDelay="580ms"
			descriptionDelay="660ms"
		/>

		<div class="mt-16 flex w-full flex-col gap-20 sm:gap-24">
			<FeatureSection
				title="Organize your changes"
				description="View your changes in a list or file tree and switch instantly, at any time."
				textDelay="760ms"
				demoDelay="860ms"
			>
				{#snippet demo()}
					{#if DemoSidebar}
						<DemoSidebar />
					{:else}
						<DemoPlaceholder />
					{/if}
				{/snippet}
			</FeatureSection>

			<FeatureSection
				title="Mark changes as seen"
				description="Mark a change as seen and move on. Reviewed files collapse and get out of your way, so you always know exactly what is left."
				reverse
				textDelay="960ms"
				demoDelay="1060ms"
			>
				{#snippet demo()}
					{#if DemoDiff}
						<DemoDiff paths={MARK_AS_SEEN_FILES} />
					{:else}
						<DemoPlaceholder />
					{/if}
				{/snippet}
			</FeatureSection>

			<FeatureSection
				title="Write your comments"
				description="Click any line to leave a comment, copy it for your agent, and come back to see it resolved in app."
				textDelay="1160ms"
				demoDelay="1260ms"
			>
				{#snippet demo()}
					{#if DemoDiff}
						<DemoDiff paths={[COMMENTS_FILE]} focusCommentId={SEED_COMMENT.id} />
					{:else}
						<DemoPlaceholder />
					{/if}
				{/snippet}
			</FeatureSection>
		</div>
	</section>

	<BottomCta />

	<Footer />
</div>
