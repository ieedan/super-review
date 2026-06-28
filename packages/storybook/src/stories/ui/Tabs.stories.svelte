<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '@super-review/ui/components/ui/tabs';

	const { Story } = defineMeta({
		title: 'UI/Tabs',
		parameters: { layout: 'padded' }
	});
</script>

<Story name="Default">
	{#snippet template()}
		<div class="w-96">
			<Tabs value="branch">
				<TabsList>
					<TabsTrigger value="branch">Branch</TabsTrigger>
					<TabsTrigger value="unstaged">Unstaged</TabsTrigger>
					<TabsTrigger value="history">History</TabsTrigger>
					<TabsTrigger value="sessions">Sessions</TabsTrigger>
				</TabsList>
				<TabsContent value="branch" class="pt-3 text-sm text-muted-foreground">
					The committed diff for the current branch versus its base.
				</TabsContent>
				<TabsContent value="unstaged" class="pt-3 text-sm text-muted-foreground">
					Working-tree changes that have not been committed yet.
				</TabsContent>
				<TabsContent value="history" class="pt-3 text-sm text-muted-foreground">
					The branch's commit history, newest first.
				</TabsContent>
				<TabsContent value="sessions" class="pt-3 text-sm text-muted-foreground">
					Agent-documented review tours for this repo.
				</TabsContent>
			</Tabs>
		</div>
	{/snippet}
</Story>
