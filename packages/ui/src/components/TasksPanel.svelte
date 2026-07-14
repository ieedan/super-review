<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import Pause from '@lucide/svelte/icons/pause';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import * as DropdownMenu from './ui/dropdown-menu';
	import { Checkbox } from './ui/checkbox';
	import { Input } from './ui/input';
	import { Textarea } from './ui/textarea';
	import { Button } from './ui/button';
	import HarnessLogo from './HarnessLogo.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { actions, app, isReadOnlyView } from '@super-review/ui/store.svelte';
	import { formatRelative } from '@super-review/ui/utils';
	import type { Task, TaskActor } from '@super-review/core/types';

	// Tasks belong to a specific branch; a read-only branch/PR view shows another
	// branch's list, so it's rendered but not editable here.
	const readOnly = $derived(isReadOnlyView());

	// New-task composer. The notes field is revealed once a title is typed so the
	// common "just a one-liner" case stays a single input.
	let newTitle = $state('');
	let newNotes = $state('');

	function submitNew(): void {
		const title = newTitle.trim();
		if (!title) return;
		void actions.addTask(title, newNotes);
		newTitle = '';
		newNotes = '';
	}

	function onNewTitleKeydown(e: KeyboardEvent): void {
		// Enter adds (unless composing an IME sequence); Shift+Enter is left alone so
		// focus can move to the notes field naturally via Tab instead.
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			submitNew();
		}
	}

	// In the multiline notes field a plain Enter inserts a newline, so Cmd/Ctrl+Enter
	// is the submit combo (matching the commit box and comment composers).
	function isSubmitCombo(e: KeyboardEvent): boolean {
		return e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing;
	}

	function onNewNotesKeydown(e: KeyboardEvent): void {
		if (isSubmitCombo(e)) {
			e.preventDefault();
			submitNew();
		}
	}

	// Inline editing: the task id being edited, plus its draft fields.
	let editingId = $state<string | null>(null);
	let editTitle = $state('');
	let editNotes = $state('');
	// The edit title input, focused when a row enters edit mode so typing (and the
	// Escape-to-cancel / Cmd+Enter-to-save shortcuts) work without a manual click.
	let editTitleEl = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (editingId && editTitleEl) {
			editTitleEl.focus();
			editTitleEl.select();
		}
	});

	function startEdit(t: Task): void {
		if (readOnly) return;
		editingId = t.id;
		editTitle = t.title;
		editNotes = t.notes ?? '';
	}

	function cancelEdit(): void {
		editingId = null;
		editTitle = '';
		editNotes = '';
	}

	function saveEdit(id: string): void {
		const title = editTitle.trim();
		if (!title) return;
		void actions.updateTask(id, { title, notes: editNotes.trim() });
		cancelEdit();
	}

	function onEditTitleKeydown(e: KeyboardEvent, id: string): void {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			saveEdit(id);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	// Notes is multiline, so Cmd/Ctrl+Enter saves and Escape cancels; plain Enter
	// stays a newline.
	function onEditNotesKeydown(e: KeyboardEvent, id: string): void {
		if (isSubmitCombo(e)) {
			e.preventDefault();
			saveEdit(id);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	// Adding a subtask: the parent id whose inline composer is open, plus its draft.
	let addingSubtaskFor = $state<string | null>(null);
	let subtaskTitle = $state('');
	let subtaskInputEl = $state<HTMLInputElement | null>(null);
	$effect(() => {
		if (addingSubtaskFor && subtaskInputEl) subtaskInputEl.focus();
	});

	function startAddSubtask(parentId: string): void {
		if (readOnly) return;
		addingSubtaskFor = parentId;
		subtaskTitle = '';
	}

	function cancelSubtask(): void {
		addingSubtaskFor = null;
		subtaskTitle = '';
	}

	// Add the subtask but keep the composer open (and focused) so several can be
	// added in a row; Escape or the close button dismisses it.
	function submitSubtask(parentId: string): void {
		const title = subtaskTitle.trim();
		if (!title) return;
		void actions.addTask(title, undefined, parentId);
		subtaskTitle = '';
	}

	function onSubtaskKeydown(e: KeyboardEvent, parentId: string): void {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			submitSubtask(parentId);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelSubtask();
		}
	}

	// Top-level tasks (in order) and their subtasks grouped by parent id. `app.tasks`
	// is already ordered, so both preserve order.
	const topLevelTasks = $derived(app.tasks.filter((t) => !t.parentId));
	const subtasksByParent = $derived.by(() => {
		const map = new SvelteMap<string, Task[]>();
		for (const t of app.tasks) {
			if (!t.parentId) continue;
			const list = map.get(t.parentId) ?? [];
			list.push(t);
			map.set(t.parentId, list);
		}
		return map;
	});

	// Drag-and-drop reordering (mirrors UsageStatsPanel). `dragId` is the task being
	// dragged; `dropTarget` tracks which row, and which side of it, the drop would
	// land on (driving the insertion bar). Reordering stays within a sibling group:
	// top-level tasks reorder among themselves (subtasks follow their parent), and a
	// subtask reorders among its siblings.
	let dragId = $state<string | null>(null);
	let dropTarget = $state<{ id: string; after: boolean } | null>(null);

	function sameGroup(a: Task, b: Task): boolean {
		return (a.parentId ?? null) === (b.parentId ?? null);
	}

	function onGripDragStart(e: DragEvent, t: Task): void {
		if (readOnly) return;
		dragId = t.id;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', t.id);
			// Drag the whole row rather than just the tiny grip handle.
			const row = (e.currentTarget as HTMLElement).closest('[data-task-row]');
			if (row instanceof HTMLElement) e.dataTransfer.setDragImage(row, 12, 12);
		}
	}

	function onRowDragEnd(): void {
		dragId = null;
		dropTarget = null;
	}

	function onRowDragOver(e: DragEvent, t: Task): void {
		if (!dragId) return;
		const dragged = app.tasks.find((x) => x.id === dragId);
		// Only allow dropping onto a row in the same sibling group.
		if (!dragged || t.id === dragId || !sameGroup(dragged, t)) {
			dropTarget = null;
			return;
		}
		e.preventDefault();
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		dropTarget = { id: t.id, after: e.clientY > r.top + r.height / 2 };
	}

	function onRowDrop(e: DragEvent): void {
		e.preventDefault();
		const fromId = dragId;
		const target = dropTarget;
		dragId = null;
		dropTarget = null;
		if (!fromId || !target || fromId === target.id) return;
		void actions.reorderTasks(flatOrderAfterMove(fromId, target.id, target.after));
	}

	function reorderIds(ids: string[], fromId: string, targetId: string, after: boolean): string[] {
		const order = ids.filter((id) => id !== fromId);
		const idx = order.indexOf(targetId) + (after ? 1 : 0);
		order.splice(idx, 0, fromId);
		return order;
	}

	// The full flat id list (each top-level task followed by its subtasks) after
	// moving `fromId` next to `targetId`. A moved top-level task carries its
	// subtasks; a moved subtask reorders only within its parent's group.
	function flatOrderAfterMove(fromId: string, targetId: string, after: boolean): string[] {
		const from = app.tasks.find((t) => t.id === fromId);
		const topIds = topLevelTasks.map((t) => t.id);
		const childIds = (pid: string): string[] => (subtasksByParent.get(pid) ?? []).map((t) => t.id);
		if (!from) return app.tasks.map((t) => t.id);
		if (!from.parentId) {
			const newTop = reorderIds(topIds, fromId, targetId, after);
			return newTop.flatMap((id) => [id, ...childIds(id)]);
		}
		const pid = from.parentId;
		const newChildren = reorderIds(childIds(pid), fromId, targetId, after);
		return topIds.flatMap((id) => (id === pid ? [id, ...newChildren] : [id, ...childIds(id)]));
	}

	// Native right-click menu on a task row (toggle / add subtask / edit / delete),
	// matching the app's native-menu convention. The renderer runs the chosen
	// action. "Add Subtask" is offered on top-level tasks only.
	async function onRowContextMenu(e: MouseEvent, t: Task): Promise<void> {
		if (readOnly) return;
		e.preventDefault();
		const action = await window.api.menu.showTaskContextMenu({
			done: t.done,
			onHold: !!t.onHold,
			canAddSubtask: !t.parentId
		});
		if (action === 'toggle') void actions.toggleTask(t.id, !t.done);
		else if (action === 'hold') void actions.setTaskHold(t.id, !t.onHold);
		else if (action === 'addSubtask') startAddSubtask(t.id);
		else if (action === 'edit') startEdit(t);
		else if (action === 'delete') void actions.removeTask(t.id);
	}
</script>

{#snippet actor(a: TaskActor)}
	{#if a.kind === 'agent' && a.harness}
		<HarnessLogo harness={a.harness} size={12} />
	{:else if a.avatarUrl}
		<img class="size-3 shrink-0 rounded-full" src={a.avatarUrl} alt={a.name} />
	{/if}
	<span class="truncate">{a.name}</span>
{/snippet}

<!-- One task row: the inline editor when it's being edited, otherwise the
     checkbox + title + overflow menu. `isSub` indents subtasks and hides the
     "Add subtask" action (tasks nest one level only). -->
{#snippet taskRow(t: Task, isSub: boolean)}
	{#if editingId === t.id}
		<div class={['py-2.5 pr-3', isSub ? 'pl-9' : 'pl-3']}>
			<Input
				bind:ref={editTitleEl}
				bind:value={editTitle}
				onkeydown={(e: KeyboardEvent) => onEditTitleKeydown(e, t.id)}
				class="h-8 text-sm"
			/>
			<Textarea
				bind:value={editNotes}
				onkeydown={(e: KeyboardEvent) => onEditNotesKeydown(e, t.id)}
				placeholder="Notes (optional)"
				class="mt-1.5 min-h-0 resize-none text-xs"
				rows={2}
			/>
			<div class="mt-1.5 flex justify-end gap-1.5">
				<Button variant="ghost" size="sm" class="h-7" onclick={cancelEdit}>
					<X class="size-3.5" /> Cancel
				</Button>
				<Button
					size="sm"
					class="h-7"
					disabled={editTitle.trim().length === 0}
					onclick={() => saveEdit(t.id)}
				>
					<Check class="size-3.5" /> Save
				</Button>
			</div>
		</div>
	{:else}
		<div
			data-task-row
			class={[
				'group relative flex gap-2.5 pr-3',
				isSub ? 'py-2 pl-9' : 'py-2.5 pl-3',
				// A held task is dimmed (upcoming, not ready); the drag ghost dims more.
				dragId === t.id ? 'opacity-40' : t.onHold && !t.done ? 'opacity-60' : ''
			]}
			oncontextmenu={(e) => onRowContextMenu(e, t)}
			ondragover={(e) => onRowDragOver(e, t)}
			ondrop={onRowDrop}
			role="listitem"
		>
			<!-- Insertion bar: shows where a dragged row will land. -->
			{#if dropTarget?.id === t.id}
				<span
					class="pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-primary {dropTarget.after
						? 'bottom-0'
						: 'top-0'}"
				></span>
			{/if}
			<Checkbox
				checked={t.done}
				disabled={readOnly}
				class="mt-0.5"
				onCheckedChange={(v) => actions.toggleTask(t.id, v === true)}
			/>
			<div class="min-w-0 flex-1">
				<div class="flex items-start gap-2">
					<p
						class={[
							'min-w-0 flex-1 text-[13px] break-words whitespace-pre-wrap',
							t.done && 'text-muted-foreground line-through'
						]}
					>
						{t.title}
					</p>
					{#if !readOnly}
						<div class="flex shrink-0 items-center gap-0.5">
							<!-- Grab handle: only the handle initiates a drag, so the checkbox,
							     title, and menu stay clickable. The whole row is the drop zone. -->
							<button
								type="button"
								draggable="true"
								aria-label="Drag to reorder"
								title="Drag to reorder"
								class="grid size-6 cursor-grab place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground active:cursor-grabbing"
								ondragstart={(e) => onGripDragStart(e, t)}
								ondragend={onRowDragEnd}
							>
								<GripVertical class="size-4" />
							</button>
							<!-- Edit, delete, and (top-level only) add-subtask live under one
							     overflow menu. Right-click on the row opens the same actions
							     natively. The trigger shows on row hover or while its menu is open. -->
							<DropdownMenu.Root>
								<DropdownMenu.Trigger
									class="grid size-6 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground data-[state=open]:opacity-100"
									aria-label="Task actions"
								>
									<MoreHorizontal class="size-4" />
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end" class="w-auto!">
									{#if !isSub}
										<DropdownMenu.Item onSelect={() => startAddSubtask(t.id)}>
											<Plus class="size-3.5" /> Add subtask
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
									{/if}
									<DropdownMenu.Item onSelect={() => actions.setTaskHold(t.id, !t.onHold)}>
										<Pause class="size-3.5" />
										{t.onHold ? 'Remove hold' : 'Put on hold'}
									</DropdownMenu.Item>
									<DropdownMenu.Item onSelect={() => startEdit(t)}>
										<Pencil class="size-3.5" /> Edit
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										variant="destructive"
										onSelect={() => actions.removeTask(t.id)}
									>
										<Trash2 class="size-3.5" /> Delete
									</DropdownMenu.Item>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
						</div>
					{/if}
				</div>
				{#if t.notes?.trim()}
					<p class="mt-0.5 line-clamp-3 text-[11px] whitespace-pre-wrap text-muted-foreground">
						{t.notes}
					</p>
				{/if}
				<div
					class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground"
				>
					{#if t.onHold && !t.done}
						<span class="flex items-center gap-1 font-medium">
							<Pause class="size-3" /> On hold
						</span>
						<span aria-hidden="true">·</span>
					{/if}
					<span class="flex items-center gap-1">
						Added by {@render actor(t.createdBy)}
					</span>
					{#if t.done && t.doneBy}
						<span aria-hidden="true">·</span>
						<span class="flex items-center gap-1">
							done{t.doneAt ? ` ${formatRelative(t.doneAt)}` : ''} by
							{@render actor(t.doneBy)}
						</span>
					{/if}
				</div>
			</div>
		</div>
	{/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col">
	{#if !readOnly}
		<!-- New-task composer, pinned above the scrolling list. -->
		<div class="shrink-0 border-b border-border p-2">
			<div class="flex items-start gap-1.5">
				<Input
					bind:value={newTitle}
					onkeydown={onNewTitleKeydown}
					placeholder="Add a task…"
					class="h-8 text-sm"
				/>
				<Button
					size="icon-sm"
					class="mt-0.5 shrink-0"
					title="Add task"
					disabled={newTitle.trim().length === 0}
					onclick={submitNew}
				>
					<Plus class="size-4" />
				</Button>
			</div>
			{#if newTitle.trim().length > 0}
				<Textarea
					bind:value={newNotes}
					onkeydown={onNewNotesKeydown}
					placeholder="Notes (optional)"
					class="mt-1.5 min-h-0 resize-none text-xs"
					rows={2}
				/>
			{/if}
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if app.tasksLoading && app.tasks.length === 0}
			<div class="grid h-full place-items-center p-6 text-center">
				<p class="text-sm text-muted-foreground">Loading tasks…</p>
			</div>
		{:else if app.tasks.length === 0}
			<div class="grid h-full place-items-center p-6 text-center">
				<div>
					<p class="text-sm text-muted-foreground">No tasks yet</p>
					<p class="mt-1 text-xs text-muted-foreground">
						{#if readOnly}
							This branch has no task list.
						{:else}
							Track what's left before you open a pull request.
						{/if}
					</p>
				</div>
			</div>
		{:else}
			<ul>
				{#each topLevelTasks as t (t.id)}
					<li class="border-b border-border">
						{@render taskRow(t, false)}
						{#each subtasksByParent.get(t.id) ?? [] as sub (sub.id)}
							{@render taskRow(sub, true)}
						{/each}
						{#if addingSubtaskFor === t.id}
							<!-- Inline subtask composer, indented under the parent. Stays open
							     after adding so several subtasks can be entered in a row. -->
							<div class="flex items-center gap-1.5 py-2 pr-3 pl-9">
								<Input
									bind:ref={subtaskInputEl}
									bind:value={subtaskTitle}
									onkeydown={(e: KeyboardEvent) => onSubtaskKeydown(e, t.id)}
									placeholder="Subtask title…"
									class="h-8 text-sm"
								/>
								<Button
									size="icon-sm"
									class="shrink-0"
									title="Add subtask"
									disabled={subtaskTitle.trim().length === 0}
									onclick={() => submitSubtask(t.id)}
								>
									<Plus class="size-4" />
								</Button>
								<Button
									variant="ghost"
									size="icon-sm"
									class="shrink-0 text-muted-foreground"
									title="Done adding subtasks"
									onclick={cancelSubtask}
								>
									<X class="size-4" />
								</Button>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
