<script lang="ts">
	import WaitlistForm from '$lib/components/WaitlistForm.svelte';

	const screenshot: string | null = '/app-preview.webp';
</script>

<main class="pb-16 pt-10 sm:pb-20 sm:pt-14">
	<div class="relative lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-x-10">
		<div class="flex flex-col items-center text-center lg:items-start lg:text-left">
			<h1
				class="reveal font-display max-w-2xl text-4xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-5xl lg:text-[3.25rem]"
				style="animation-delay: 40ms"
			>
				A faster, saner way to review
				<span class="flame-text">agent-written code.</span>
			</h1>

			<p
				class="reveal text-muted-foreground mt-5 max-w-lg text-base leading-relaxed text-pretty sm:text-lg"
				style="animation-delay: 160ms"
			>
				Super Review is a git client built for actually reviewing massive, agent-written PRs.
			</p>

			<div
				id="waitlist"
				class="reveal mt-8 w-full max-w-md scroll-mt-24 lg:max-w-xl"
				style="animation-delay: 240ms"
			>
				<WaitlistForm />
			</div>
		</div>

		<div
			class="reveal pointer-events-none mx-auto mt-10 hidden shrink-0 lg:mx-0 lg:mt-2 lg:block"
			style="animation-delay: 200ms"
			aria-hidden="true"
		>
			<img src="/icon.png" alt="" class="h-24 w-24 rounded-2xl shadow-2xl" />
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
