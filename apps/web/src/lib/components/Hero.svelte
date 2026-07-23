<script lang="ts">
	import { Button } from '@super-review/ui/components/ui/button';
	import { page } from '$app/state';
	import WaitlistForm from './WaitlistForm.svelte';

	const screenshot: string | null = '/app-preview.webp';

	// Pre-launch the hero collects emails instead of pointing at pricing. Driven
	// by the Convex settings row loaded in the marketing layout, so it flips live.
	const waitlistMode = $derived(page.data.settings?.data?.waitlistMode ?? false);
</script>

<main class="pb-16 pt-10 sm:pb-20 sm:pt-14">
	<div class="relative lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-x-10">
		<div class="flex flex-col items-center text-center lg:items-start lg:text-left">
			<h1
				class="reveal font-display max-w-2xl text-4xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-5xl lg:text-[3.25rem]"
				style="animation-delay: 40ms"
			>
				Code review for the
				<span class="flame-text">agentic era.</span>
			</h1>

			<p
				class="reveal text-muted-foreground mt-5 max-w-lg text-base leading-relaxed text-pretty sm:text-lg"
				style="animation-delay: 160ms"
			>
				Super Review is a git client built for actually reviewing massive, agent-written PRs.
			</p>

			<div
				class="reveal mt-8 flex w-full max-w-md items-center justify-center gap-3 lg:justify-start"
				style="animation-delay: 240ms"
			>
				{#if waitlistMode}
					<WaitlistForm align="start" />
				{:else}
					<Button href="/#pricing" class="h-11 rounded-xl px-6">Get Super Review</Button>
					<a
						href="/login"
						class="border-line text-muted-foreground hover:text-fg inline-flex h-11 items-center rounded-xl border px-6 text-sm font-semibold transition-colors"
					>
						Sign in
					</a>
				{/if}
			</div>
		</div>
	</div>

	<div class="reveal mt-12 w-full sm:mt-14" style="animation-delay: 320ms">
		<div class="border-line overflow-hidden rounded-2xl border text-left">
			{#if screenshot}
				<img src={screenshot} alt="Super Review app preview" class="block w-full" />
			{/if}
		</div>
	</div>
</main>
