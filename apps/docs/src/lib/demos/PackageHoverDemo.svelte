<script lang="ts">
	// Lazy boundary for the package.json hover demo. The real PackageHoverCard and
	// its markdown/Shiki rendering stack load only when this scrolls into view.
	import LazyInView from './LazyInView.svelte';
</script>

<LazyInView load={() => import('./PackageHoverInner.svelte')} minHeight="320px" />
