<script lang="ts">
	import Code from '@lucide/svelte/icons/code';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Github from './icons/GithubIcon.svelte';
	import UsageStatsPanel from './UsageStatsPanel.svelte';
	import { actions, app, effectiveEditor, EDITOR_LABELS } from '@super-review/ui/store.svelte';
	import { DEFAULT_EMPTY_VIEW_ITEMS, type EmptyViewItemVisibility } from '@super-review/core/types';

	// Which repo-level actions can we actually offer? Each card only renders
	// when its action is meaningful — no editor configured, no GitHub remote,
	// etc. — so the empty state never dangles a button that does nothing.
	const editor = $derived(effectiveEditor());
	const hasRemote = $derived(!!(app.activeRepo?.githubOwner && app.activeRepo?.githubRepo));

	// "Show in Finder" on macOS, but the OS file manager is named differently
	// elsewhere — mirror the label the file-row context menu uses.
	const revealLabel = $derived(
		app.platform === 'win32' ? 'Explorer' : app.platform === 'linux' ? 'File Manager' : 'Finder'
	);

	// Which blocks the user has chosen to show here (right-click to toggle).
	const items = $derived(app.prefs?.emptyViewItems ?? DEFAULT_EMPTY_VIEW_ITEMS);
	const showAnyAction = $derived(
		(editor && items.editor) || items.reveal || (hasRemote && items.github)
	);

	// Right-click anywhere on the empty view to hide/show its blocks, via a native
	// context menu. Only blocks that are actually applicable here are offered
	// (e.g. the editor toggle appears only when an editor is configured).
	async function onContextMenu(e: MouseEvent): Promise<void> {
		if (!app.activeRepo) return;
		e.preventDefault();
		const entries: { key: keyof EmptyViewItemVisibility; label: string }[] = [];
		if (editor) entries.push({ key: 'editor', label: `Open in ${EDITOR_LABELS[editor]}` });
		entries.push({ key: 'reveal', label: `Show in ${revealLabel}` });
		if (hasRemote) entries.push({ key: 'github', label: 'View on GitHub' });
		entries.push({ key: 'stats', label: 'Usage stats' });
		const result = await window.api.menu.showEmptyViewContextMenu({
			items: entries.map((it) => ({ key: it.key, label: it.label, checked: items[it.key] }))
		});
		if (result) actions.setEmptyViewItem(result.key, result.checked);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex h-full w-full flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-10"
	oncontextmenu={onContextMenu}
>
	<div class="w-full max-w-md">
		<h1 class="text-center text-2xl font-semibold">No local changes</h1>
		<p class="mt-2 text-center text-sm text-muted-foreground">
			There are no uncommitted changes in this repository. Here are some things you can do next.
		</p>
		{#if showAnyAction}
			<div class="mt-6 grid gap-3">
				{#if editor && items.editor}
					<button
						type="button"
						class="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
						onclick={() => actions.openInEditor()}
					>
						<Code class="mt-0.5 size-5 text-muted-foreground" />
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">
								Open in {EDITOR_LABELS[editor]}
							</div>
							<div class="text-xs text-muted-foreground">
								Open the repository in your external editor.
							</div>
						</div>
					</button>
				{/if}

				{#if items.reveal}
					<button
						type="button"
						class="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
						onclick={() => actions.openRepoInFileManager()}
					>
						<FolderOpen class="mt-0.5 size-5 text-muted-foreground" />
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">Show in {revealLabel}</div>
							<div class="text-xs text-muted-foreground">
								View the repository's files in {revealLabel}.
							</div>
						</div>
					</button>
				{/if}

				{#if hasRemote && items.github}
					<button
						type="button"
						class="flex items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent"
						onclick={() => actions.openRepoOnGithub()}
					>
						<Github class="mt-0.5 size-5 text-muted-foreground" />
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium">View on GitHub</div>
							<div class="text-xs text-muted-foreground">
								Open the repository page in your browser.
							</div>
						</div>
						<ExternalLink class="size-4 shrink-0 self-center text-muted-foreground" />
					</button>
				{/if}
			</div>
		{/if}
	</div>

	{#if items.stats}
		<div class="w-full max-w-md">
			<UsageStatsPanel />
		</div>
	{/if}
</div>
