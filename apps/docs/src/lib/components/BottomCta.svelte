<script lang="ts">
	import WaitlistForm from '$lib/components/WaitlistForm.svelte';
</script>

<section
	class="border-line flex flex-col items-center border-t py-14 text-center sm:py-16"
	style="animation-delay: 560ms"
	aria-label="Join the waitlist"
>
	<h2
		class="reveal font-display max-w-md text-2xl font-bold tracking-tight text-balance sm:max-w-lg sm:text-3xl"
		style="animation-delay: 560ms"
	>
		Ready to actually <span class="flame-text">read the code?</span>
	</h2>
	<div class="reveal mt-6 w-full max-w-md sm:mt-8 sm:max-w-lg" style="animation-delay: 640ms">
		<WaitlistForm />
	</div>
</section>
