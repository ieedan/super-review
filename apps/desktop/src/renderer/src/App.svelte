<script lang="ts">
	import { onMount } from 'svelte';
	import ActivationScreen from '@super-review/ui/components/ActivationScreen.svelte';
	import { actions, licenseBlocked, licenseResolved } from '@super-review/ui/store.svelte';
	import { Agentation, type AnnotationProps } from 'sv-agentation';
	import LicensedApp from './LicensedApp.svelte';

	// Dev-only in-app inspector for annotating elements to hand back as feedback.
	// `import.meta.env.DEV` is Vite's compile-time flag, so the component and its
	// import are tree-shaken out of production builds. The renderer has no SSR, so
	// no browser guard is needed. Absolute path to the desktop app so Agentation's
	// source links resolve to the real files on disk.
	const annotationProps: AnnotationProps = {
		workspaceRoot: '/Users/ieedan/Documents/github/super-local-review/apps/desktop'
	};

	onMount(() => {
		void actions.initLicense();
	});
</script>

{#if !licenseResolved()}
	<!--
		Nothing until the first license fetch lands. Rendering either branch here
		would flash it: the activation screen on licensed launches, the main UI on
		unlicensed ones.
	-->
	<div class="h-screen w-full"></div>
{:else if licenseBlocked()}
	<ActivationScreen />
{:else}
	<LicensedApp />
{/if}

{#if import.meta.env.DEV}
	<Agentation {...annotationProps} />
{/if}
