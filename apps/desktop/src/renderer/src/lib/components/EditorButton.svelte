<script lang="ts">
	import { Code2 } from 'lucide-svelte';
	import CursorIcon from './icons/CursorIcon.svelte';
	import VSCodeIcon from './icons/VSCodeIcon.svelte';
	import XcodeIcon from './icons/XcodeIcon.svelte';
	import ZedIcon from './icons/ZedIcon.svelte';
	import VisualStudioIcon from './icons/VisualStudioIcon.svelte';
	import { Button } from './ui/button';
	import { actions, app, effectiveEditor } from '$lib/store.svelte';
	import type { EditorKind } from '@shared/types';

	const editor = $derived<EditorKind | null>(effectiveEditor());
	const anyAvailable = $derived(
		app.editors.cursor ||
			app.editors.vscode ||
			app.editors.zed ||
			app.editors.xcode ||
			app.editors.visualstudio
	);

	const editorLabels: Record<EditorKind, string> = {
		cursor: 'Cursor',
		vscode: 'Visual Studio Code',
		zed: 'Zed',
		xcode: 'Xcode',
		visualstudio: 'Visual Studio'
	};

	async function openRepo(): Promise<void> {
		await actions.openInEditor();
	}
</script>

{#if anyAvailable}
	<Button
		variant="ghost"
		size="icon-sm"
		onclick={openRepo}
		title={editor ? `Open in ${editorLabels[editor]}` : 'Open in editor'}
	>
		{#if editor === 'cursor'}
			<CursorIcon class="size-4" />
		{:else if editor === 'vscode'}
			<VSCodeIcon class="size-4" />
		{:else if editor === 'zed'}
			<ZedIcon class="size-4" />
		{:else if editor === 'xcode'}
			<XcodeIcon class="size-4" />
		{:else if editor === 'visualstudio'}
			<VisualStudioIcon class="size-4" />
		{:else}
			<Code2 class="size-4" />
		{/if}
	</Button>
{/if}
