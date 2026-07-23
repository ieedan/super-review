<script lang="ts">
	import Logo from '$lib/components/Logo.svelte';
</script>

<footer
	class="border-line text-faint flex flex-col items-center justify-between gap-4 border-t py-8 text-sm sm:flex-row"
>
	<Logo size="sm" />
	<span>&copy; {new Date().getFullYear()} Super Review</span>
</footer>
