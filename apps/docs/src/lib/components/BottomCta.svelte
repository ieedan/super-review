<script lang="ts">
	import WaitlistForm from '$lib/components/WaitlistForm.svelte';
</script>

<section
	class="reveal border-line flex flex-col items-center border-t py-14 text-center sm:py-16"
	style="animation-delay: 560ms"
	aria-label="Join the waitlist"
>
	<div class="w-full max-w-md">
		<WaitlistForm />
	</div>
</section>
