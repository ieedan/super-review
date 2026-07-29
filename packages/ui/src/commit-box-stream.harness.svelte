<script lang="ts">
	// CommitBox under an animations provider, for commit-box-stream.browser.test.ts.
	// `useAnimations()` falls back to "none" with no provider mounted, and the box
	// reads that as "do not pace the reveal" — so a bare render would paint the
	// answer whole and the test would pass against the very bug it exists for.
	import { setAnimations } from '@super-review/ui/hooks/use-animations.svelte';
	import CommitBox from '@super-review/ui/components/CommitBox.svelte';
	import type { AnimationMode } from '@super-review/core/types';

	let { mode = 'all' as AnimationMode }: { mode?: AnimationMode } = $props();

	setAnimations(() => mode);
</script>

<CommitBox />
