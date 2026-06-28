<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import FileListPreview from '@super-review/ui/components/FileListPreview.svelte';

	// FileListPreview is the self-contained settings preview of the file tree: it
	// ships its own fixed mock changeset and just switches between the 'tree' and
	// 'list' layouts. It's the lightweight, prop-driven sibling of the full
	// FileList component (see FileList.stories).
	const { Story } = defineMeta({
		title: 'Components/File List Preview',
		component: FileListPreview,
		tags: ['autodocs'],
		argTypes: {
			layout: { control: 'inline-radio', options: ['tree', 'list'] },
			showIcons: { control: 'boolean' }
		},
		args: { layout: 'tree', showIcons: true },
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Tree" args={{ layout: 'tree' }} />

<Story name="List" args={{ layout: 'list' }} />

<Story name="No icons" args={{ layout: 'tree', showIcons: false }} />
