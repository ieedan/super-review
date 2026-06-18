<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Folder from '@lucide/svelte/icons/folder';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import { cn } from '$lib/utils';
	import FileIcon from './FileIcon.svelte';
	import type { ChangedFile, FileListLayout } from '@shared/types';

	// A faithful, non-interactive miniature of FileList — rendered with the
	// same row markup so the picker in Settings reflects what the sidebar will
	// actually look like for each layout. Driven by a fixed mock changeset
	// rather than the app store.

	interface Props {
		layout: FileListLayout;
		showIcons?: boolean;
	}

	let { layout, showIcons = true }: Props = $props();

	// Match FileList.svelte's ROW_HEIGHT so the preview reads the same
	// visually as the real list.
	const ROW_HEIGHT = 20;

	type PreviewNode =
		| {
				kind: 'folder';
				path: string;
				name: string;
				depth: number;
				open: boolean;
				childCount: number;
		  }
		| {
				kind: 'file';
				path: string;
				name: string;
				dirPrefix?: string;
				depth: number;
				file: ChangedFile;
		  };

	function file(path: string, additions: number, deletions: number): ChangedFile {
		return { path, status: 'modified', additions, deletions, isBinary: false };
	}

	const MOCK_FILES: ChangedFile[] = [
		file('src/main.ts', 12, 3),
		file('src/utils/format.ts', 5, 1),
		file('README.md', 2, 0)
	];

	const nodes = $derived.by<PreviewNode[]>(() => {
		if (layout === 'list') {
			return MOCK_FILES.map((f) => {
				const slash = f.path.lastIndexOf('/');
				const dirPrefix = slash >= 0 ? f.path.slice(0, slash) : '';
				const name = slash >= 0 ? f.path.slice(slash) : f.path;
				return {
					kind: 'file' as const,
					path: f.path,
					name,
					dirPrefix,
					depth: 0,
					file: f
				};
			});
		}
		return [
			{ kind: 'folder', path: 'src', name: 'src', depth: 0, open: true, childCount: 2 },
			{
				kind: 'file',
				path: 'src/main.ts',
				name: 'main.ts',
				depth: 1,
				file: MOCK_FILES[0]
			},
			{
				kind: 'folder',
				path: 'src/utils',
				name: 'utils',
				depth: 1,
				open: true,
				childCount: 1
			},
			{
				kind: 'file',
				path: 'src/utils/format.ts',
				name: 'format.ts',
				depth: 2,
				file: MOCK_FILES[1]
			},
			{
				kind: 'file',
				path: 'README.md',
				name: 'README.md',
				depth: 0,
				file: MOCK_FILES[2]
			}
		];
	});
</script>

<div class="w-full overflow-hidden">
	{#each nodes as node (node.kind + ':' + node.path)}
		{#if node.kind === 'folder'}
			<div
				class="flex w-full items-center gap-1 px-2 text-[10px] text-muted-foreground"
				style="height: {ROW_HEIGHT}px; padding-left: {node.depth * 10 + 6}px"
			>
				<ChevronRight
					class={cn('size-2.5 shrink-0 transition-transform', node.open && 'rotate-90')}
				/>
				{#if node.open}
					<FolderOpen class="size-3 shrink-0 text-muted-foreground" />
				{:else}
					<Folder class="size-3 shrink-0 text-muted-foreground" />
				{/if}
				<span class="truncate">{node.name}</span>
				<span class="ml-auto pr-1 tabular-nums">{node.childCount}</span>
			</div>
		{:else}
			<div
				class="flex w-full items-center gap-1.5 border-l-2 border-transparent pr-2"
				style="height: {ROW_HEIGHT}px; padding-left: {node.depth * 10 + 6}px"
			>
				<span class="grid size-2.5 shrink-0 place-items-center rounded-[3px] border border-border"
				></span>
				{#if showIcons}
					<FileIcon path={node.file.path} class="size-3 shrink-0" />
				{/if}
				{#if node.dirPrefix !== undefined}
					<span class="flex min-w-0 flex-1 items-center text-[10px]"
						>{#if node.dirPrefix}<span class="min-w-0 truncate text-muted-foreground"
								>{node.dirPrefix}</span
							>{/if}<span class="shrink-0">{node.name}</span></span
					>
				{:else}
					<span class="truncate text-[10px]">{node.name}</span>
				{/if}
				<span class="ml-auto flex shrink-0 items-center gap-0.5 text-[9px] tabular-nums">
					{#if node.file.additions > 0}
						<span class="text-success">+{node.file.additions}</span>
					{/if}
					{#if node.file.deletions > 0}
						<span class="text-destructive">−{node.file.deletions}</span>
					{/if}
				</span>
			</div>
		{/if}
	{/each}
</div>
