<script lang="ts">
	// Lazy boundary for the diff customization demo. The real @pierre/diffs-based
	// components (and the Shiki/WASM worker they pull in) load only when this
	// scrolls into view — see DiffCustomizeInner.
	import LazyInView from './LazyInView.svelte';
</script>

<LazyInView load={() => import('./DiffCustomizeInner.svelte')} minHeight="440px" />
