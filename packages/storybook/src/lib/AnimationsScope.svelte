<script lang="ts">
	import { setAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import type { AnimationMode } from '@super-review/core/types';

	// Storybook decorator: provides the animation context the real app sets at its
	// root (App.svelte calls setAnimations), so components that gate their motion
	// on `useAnimations()` react to the toolbar's Animations switcher exactly as
	// they do to the app's setting. Without this, stories fall back to the hook's
	// disabled default and never animate.
	let { mode = 'all', children }: { mode?: AnimationMode; children?: import('svelte').Snippet } =
		$props();

	setAnimations(() => mode);
</script>

{@render children?.()}
