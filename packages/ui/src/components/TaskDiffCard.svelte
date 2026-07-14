<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import { SvelteMap } from 'svelte/reactivity';
	import { actions, app } from '@super-review/ui/store.svelte';
	import HarnessLogo from './HarnessLogo.svelte';
	import type { Task, TaskActor } from '@super-review/core/types';

	// Shown in place of a `.super-review/tasks/*.json` manifest's deferred diff. The
	// raw JSON is noise in a review; a reader wants to see the checklist. Like
	// SessionDiffCard this renders from the loaded store list (the tasks tab keeps
	// `app.tasks` in sync with the branch/PR being viewed).
	interface Props {
		// Lets a reader fall back to the raw JSON diff.
		onViewRaw?: () => void;
	}

	let { onViewRaw }: Props = $props();

	const tasks = $derived(app.tasks);
	const openCount = $derived(tasks.filter((t) => !t.done).length);

	// Top-level tasks and their subtasks grouped by parent, so the card mirrors the
	// nesting shown in the Tasks tab.
	const topLevel = $derived(tasks.filter((t) => !t.parentId));
	const subtasksByParent = $derived.by(() => {
		const map = new SvelteMap<string, Task[]>();
		for (const t of tasks) {
			if (!t.parentId) continue;
			const list = map.get(t.parentId) ?? [];
			list.push(t);
			map.set(t.parentId, list);
		}
		return map;
	});

	// The tasks list may not be loaded yet when the diff is viewed outside the Tasks
	// tab; kick one load (guarded so an empty list doesn't loop).
	let triedLoad = $state(false);
	$effect(() => {
		if (tasks.length > 0 || triedLoad) return;
		triedLoad = true;
		void actions.loadTasks();
	});
	const empty = $derived(triedLoad && tasks.length === 0);

	function actorName(a: TaskActor | undefined): string {
		return a?.name ?? '';
	}
</script>

{#snippet taskItem(t: Task, isSub: boolean)}
	<li class={['flex items-start gap-2', isSub && 'pl-6', t.onHold && !t.done && 'opacity-60']}>
		<span
			class={[
				'mt-0.5 grid size-4 flex-none place-items-center rounded-[4px] border',
				t.done ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
			]}
		>
			{#if t.done}
				<Check class="size-3" />
			{/if}
		</span>
		<div class="min-w-0 flex-1">
			<p
				class={[
					'text-[13px] break-words whitespace-pre-wrap',
					t.done && 'text-muted-foreground line-through'
				]}
			>
				{t.title}
			</p>
			{#if t.notes?.trim()}
				<p class="mt-0.5 line-clamp-2 text-[11px] whitespace-pre-wrap text-muted-foreground">
					{t.notes}
				</p>
			{/if}
			{#if t.done && t.doneBy}
				<div class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
					{#if t.doneBy.kind === 'agent' && t.doneBy.harness}
						<HarnessLogo harness={t.doneBy.harness} size={11} />
					{/if}
					<span>done by {actorName(t.doneBy)}</span>
				</div>
			{/if}
		</div>
	</li>
{/snippet}

<div class="p-4">
	<div class="mx-auto max-w-xl rounded-lg border border-border bg-card/40 p-3">
		<div class="flex items-center gap-2">
			<div class="grid size-7 flex-none place-items-center rounded-md border border-border bg-card">
				<ListChecks class="size-4 text-muted-foreground" />
			</div>
			<span class="text-sm font-medium">Branch tasks</span>
			{#if tasks.length > 0}
				<span class="text-[11px] text-muted-foreground tabular-nums">
					{openCount} open · {tasks.length} total
				</span>
			{/if}
		</div>

		{#if empty}
			<p class="mt-3 text-center text-xs text-muted-foreground">This branch has no tasks.</p>
		{:else}
			<ul class="mt-3 space-y-2">
				{#each topLevel as t (t.id)}
					{@render taskItem(t, false)}
					{#each subtasksByParent.get(t.id) ?? [] as sub (sub.id)}
						{@render taskItem(sub, true)}
					{/each}
				{/each}
			</ul>
		{/if}
	</div>

	{#if onViewRaw}
		<div class="mt-2 text-center">
			<button
				type="button"
				class="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
				onclick={onViewRaw}
			>
				View raw diff
			</button>
		</div>
	{/if}
</div>
