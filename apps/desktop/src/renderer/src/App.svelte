<script lang="ts">
	import { onMount } from 'svelte';
	import ActivationScreen from '@super-review/ui/components/ActivationScreen.svelte';
	import AppMenuBar from '@super-review/ui/components/AppMenuBar.svelte';
	import { actions, app, licenseBlocked, licenseResolved } from '@super-review/ui/store.svelte';
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
		// Seed platform before license/init so the Windows AppMenuBar can mount on
		// the first paint (including the activation screen).
		app.platform = window.api.platform;
		void actions.initLicense();
		// Seed + subscribe to background update state here (globally), independent
		// of where it's rendered. The update notice itself rides the commit-box
		// notices stack (CommitNotices).
		void actions.initUpdater();
	});
</script>

<div class="flex h-screen w-full flex-col">
	{#if app.platform === 'win32'}
		<AppMenuBar />
	{/if}

	{#if !licenseResolved()}
		<!--
			Nothing until the first license fetch lands. Rendering either branch here
			would flash it: the activation screen on licensed launches, the main UI on
			unlicensed ones.
		-->
		<div class="h-full w-full flex-1"></div>
	{:else if licenseBlocked()}
		<div class="min-h-0 flex-1">
			<ActivationScreen />
		</div>
	{:else}
		<div class="min-h-0 flex-1">
			<LicensedApp />
		</div>
	{/if}
</div>

{#if import.meta.env.DEV}
	<Agentation {...annotationProps} />
{/if}
