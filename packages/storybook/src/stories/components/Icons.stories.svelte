<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import FileIcon from '@super-review/ui/components/FileIcon.svelte';
	import RepoIcon from '@super-review/ui/components/RepoIcon.svelte';
	import { makeRepos } from '../../lib/fixtures';

	const SAMPLE_PATHS = [
		'src/App.svelte',
		'src/main.ts',
		'package.json',
		'tsconfig.json',
		'README.md',
		'styles.css',
		'logo.svg',
		'Dockerfile',
		'.gitignore',
		'schema.sql',
		'data.yaml',
		'photo.png',
		'notes.txt',
		'index.html',
		'vite.config.ts',
		'store.svelte.ts'
	];

	// A range of icon kinds (lots of file types) for the performance grid.
	const EXTS = [
		'ts',
		'tsx',
		'js',
		'svelte',
		'css',
		'scss',
		'json',
		'md',
		'html',
		'svg',
		'png',
		'yaml',
		'toml',
		'sql',
		'sh',
		'rs',
		'go',
		'py',
		'rb',
		'java'
	];

	const repos = makeRepos(8);

	const { Story } = defineMeta({
		title: 'Components/Icons',
		parameters: { layout: 'padded' }
	});
</script>

<Story name="File icons">
	{#snippet template()}
		<div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
			{#each SAMPLE_PATHS as path (path)}
				<div class="flex items-center gap-2">
					<FileIcon {path} />
					<span class="truncate">{path}</span>
				</div>
			{/each}
		</div>
	{/snippet}
</Story>

<Story name="Repo icons">
	{#snippet template()}
		<div class="flex flex-col gap-3 text-sm">
			{#each repos as repo (repo.id)}
				<div class="flex items-center gap-2">
					<RepoIcon {repo} size="sm" />
					<RepoIcon {repo} size="md" />
					<span>{repo.name}</span>
				</div>
			{/each}
		</div>
	{/snippet}
</Story>

<!-- Performance: a thousand file icons spanning many extensions. The icon set is
     resolved per-extension, so this proves lookups + rendering stay cheap when a
     huge file tree paints an icon on every row. -->
<Story name="Performance (1000 file icons)">
	{#snippet template()}
		<div class="grid grid-cols-12 gap-1">
			{#each Array(1000) as _, i (i)}
				<FileIcon path={`file-${i}.${EXTS[i % EXTS.length]}`} class="size-4" />
			{/each}
		</div>
	{/snippet}
</Story>
