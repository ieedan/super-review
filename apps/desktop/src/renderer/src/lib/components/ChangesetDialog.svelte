<script lang="ts">
	import { untrack } from 'svelte';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import * as Dialog from './ui/dialog';
	import { Button } from './ui/button';
	import { Checkbox } from './ui/checkbox';
	import { RadioGroup, RadioGroupItem } from './ui/radio-group';
	import MarkdownComposer from './MarkdownComposer.svelte';
	import ChangesetLogo from './ChangesetLogo.svelte';
	import ChangesetPreview from './ChangesetPreview.svelte';
	import { actions, app, setError } from '$lib/store.svelte';
	import { formatChangesetFile, randomChangesetName } from '$lib/changeset';
	import FileIcon from './FileIcon.svelte';
	import type { WorkspacePackage } from '@shared/types';

	type Bump = 'patch' | 'minor' | 'major';
	const BUMPS: { value: Bump; label: string }[] = [
		{ value: 'patch', label: 'Patch' },
		{ value: 'minor', label: 'Minor' },
		{ value: 'major', label: 'Major' }
	];

	// The three wizard steps, each building up the changeset shown on the right.
	const STEPS = [
		{ title: 'Packages', hint: 'Which packages should this change release?' },
		{ title: 'Bump', hint: 'How significant is the change for those packages?' },
		{ title: 'Description', hint: 'Summarize it for the changelog. Markdown is supported.' }
	];

	const open = $derived(app.changesetDialogOpen);
	const status = $derived(app.changesetStatus);
	const packages = $derived(status?.packages ?? []);

	// Split into the packages this branch changed and the rest, so the likely
	// choices come first.
	const changedSet = $derived(new Set(status?.changedPackages ?? []));
	const changedPkgs = $derived(packages.filter((p) => changedSet.has(p.name)));
	const unchangedPkgs = $derived(packages.filter((p) => !changedSet.has(p.name)));

	let selected = $state<Record<string, boolean>>({});
	let bump = $state<Bump>('patch');
	let description = $state('');
	let step = $state(1);
	let name = $state('changeset');
	let busy = $state(false);

	// Reset the form only when the dialog transitions closed → open, pre-checking
	// the changed-but-uncovered packages. `untrack` keeps a background changeset
	// refresh (focus/poll) from re-running this and wiping the user's input.
	let wasOpen = false;
	$effect(() => {
		const isOpen = app.changesetDialogOpen;
		if (isOpen && !wasOpen) {
			untrack(() => {
				const s = app.changesetStatus;
				const covered = new Set(s?.coveredPackages ?? []);
				const preselect = new Set((s?.changedPackages ?? []).filter((p) => !covered.has(p)));
				const next: Record<string, boolean> = {};
				for (const pkg of s?.packages ?? []) next[pkg.name] = preselect.has(pkg.name);
				selected = next;
				bump = 'patch';
				description = '';
				step = 1;
				name = randomChangesetName();
				busy = false;
			});
		}
		wasOpen = isOpen;
	});

	const selectedNames = $derived(packages.filter((p) => selected[p.name]).map((p) => p.name));
	const canProceedStep1 = $derived(selectedNames.length > 0);
	const canCreate = $derived(!busy && selectedNames.length > 0 && description.trim().length > 0);

	const previewName = $derived(`.changeset/${name}.md`);
	const previewContent = $derived(
		formatChangesetFile({ packages: selectedNames, bump, description })
	);

	function setGroup(group: WorkspacePackage[], value: boolean): void {
		for (const p of group) selected[p.name] = value;
	}

	function goto(target: number): void {
		// Can't move past step 1 without a package selected.
		if (target > 1 && !canProceedStep1) return;
		step = Math.min(3, Math.max(1, target));
	}

	function onOpenChange(v: boolean): void {
		if (!v && !busy) actions.closeChangesetDialog();
	}

	async function submitCreate(): Promise<void> {
		if (!canCreate) return;
		busy = true;
		try {
			await actions.createChangeset(selectedNames, bump, description, name);
		} finally {
			busy = false;
		}
	}

	// Enter (via the primary button) advances through the steps, then creates.
	function onSubmit(e: Event): void {
		e.preventDefault();
		if (busy) return;
		if (step < 3) {
			if (step === 1 && !canProceedStep1) return;
			step += 1;
		} else {
			void submitCreate();
		}
	}

	function onDescriptionKeydown(e: KeyboardEvent): void {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			void submitCreate();
		}
	}
</script>

{#snippet pkgGroup(id: string, label: string, group: WorkspacePackage[])}
	{#if group.length > 0}
		{@const allChecked = group.every((p) => selected[p.name])}
		{@const anyChecked = group.some((p) => selected[p.name])}
		<div>
			<label
				for={id}
				class="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-accent/50"
			>
				<Checkbox
					{id}
					checked={allChecked}
					indeterminate={anyChecked && !allChecked}
					onCheckedChange={(v) => setGroup(group, v === true)}
					disabled={busy}
				/>
				<span
					class="flex-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
				>
					{label}
				</span>
				<span class="text-[10px] text-muted-foreground tabular-nums">{group.length}</span>
			</label>
			{#each group as pkg (pkg.name)}
				<label
					for={`cs-pkg-${pkg.name}`}
					class="flex cursor-pointer items-center gap-2 rounded-sm py-1 pr-2 pl-7 hover:bg-accent/50"
				>
					<Checkbox
						id={`cs-pkg-${pkg.name}`}
						checked={selected[pkg.name] ?? false}
						onCheckedChange={(v) => (selected[pkg.name] = v === true)}
						disabled={busy}
					/>
					<span class="min-w-0 flex-1 truncate text-sm">{pkg.name}</span>
					{#if pkg.private}
						<span class="shrink-0 text-[10px] text-muted-foreground">private</span>
					{/if}
				</label>
			{/each}
		</div>
	{/if}
{/snippet}

<Dialog.Root {open} {onOpenChange}>
	<!-- Fixed height (capped to the viewport) so stepping through the wizard, whose
	     steps have different natural heights, never resizes the dialog. Sized to fit
	     the tallest step (the package list); each pane scrolls within it if needed. -->
	<Dialog.Content class="flex h-[26rem] max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				<ChangesetLogo class="h-4 w-auto" />
				Add a changeset
			</Dialog.Title>
		</Dialog.Header>

		<form class="flex min-h-0 flex-1 flex-col gap-4" onsubmit={onSubmit}>
			<div class="grid min-h-0 flex-1 grid-cols-2 divide-x divide-border">
				<!-- Left: the step wizard -->
				<div class="flex min-h-0 min-w-0 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-4">
					<!-- Progress -->
					<div class="flex items-center gap-1.5">
						{#each STEPS as s, i (s.title)}
							<button
								type="button"
								title={s.title}
								onclick={() => goto(i + 1)}
								class="h-1 flex-1 rounded-full transition-colors {step === i + 1
									? 'bg-primary'
									: step > i + 1
										? 'bg-primary/40'
										: 'bg-border'}"
								aria-label={`Step ${i + 1}: ${s.title}`}
							></button>
						{/each}
					</div>
					<div class="grid gap-0.5">
						<span class="text-[11px] text-muted-foreground">Step {step} of {STEPS.length}</span>
						<h3 class="text-sm font-medium">{STEPS[step - 1].title}</h3>
						<p class="text-xs text-muted-foreground">{STEPS[step - 1].hint}</p>
					</div>

					<!-- Step body -->
					<div class="min-h-0 flex-1">
						{#if step === 1}
							{#if packages.length === 0}
								<p class="text-xs text-muted-foreground">No releasable packages found.</p>
							{:else}
								<div class="grid gap-1 rounded-md border border-border p-1">
									{@render pkgGroup('cs-group-changed', 'Changed', changedPkgs)}
									{@render pkgGroup('cs-group-unchanged', 'Unchanged', unchangedPkgs)}
								</div>
							{/if}
						{:else if step === 2}
							<RadioGroup bind:value={bump} disabled={busy} class="grid gap-2">
								{#each BUMPS as b (b.value)}
									<label
										for={`cs-bump-${b.value}`}
										class="relative flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 dark:has-[[data-state=checked]]:bg-primary/10"
									>
										<RadioGroupItem id={`cs-bump-${b.value}`} value={b.value} />
										<span class="font-medium">{b.label}</span>
									</label>
								{/each}
							</RadioGroup>
						{:else}
							<MarkdownComposer
								bind:value={description}
								placeholder="What changed?"
								disabled={busy}
								autofocus
								onkeydown={onDescriptionKeydown}
								imageUpload={{ mode: 'remote' }}
								onImageError={setError}
							/>
						{/if}
					</div>
				</div>

				<!-- Right: live preview of the file being authored -->
				<div class="flex min-h-0 min-w-0 flex-col gap-2 pl-4">
					<span class="text-xs font-medium text-muted-foreground">Your changeset</span>
					<div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
						<!-- Mirrors the diff file header in the review tab: language icon + path
						     on a card-tinted bar. -->
						<header class="flex h-9 items-center gap-2 border-b border-border bg-card/95 px-3">
							<FileIcon path={previewName} class="size-3.5 shrink-0" />
							<span
								class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
								title={previewName}
							>
								{previewName}
							</span>
						</header>
						<div class="min-h-0 flex-1 overflow-auto">
							<ChangesetPreview filename={previewName} content={previewContent} />
						</div>
					</div>
				</div>
			</div>

			<Dialog.Footer class="sm:justify-between">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={busy}
					onclick={() => actions.closeChangesetDialog()}
				>
					Cancel
				</Button>
				<div class="flex gap-2">
					{#if step > 1}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={busy}
							onclick={() => goto(step - 1)}
						>
							Back
						</Button>
					{/if}
					{#if step < STEPS.length}
						<Button type="submit" size="sm" disabled={step === 1 && !canProceedStep1}>Next</Button>
					{:else}
						<Button type="submit" size="sm" disabled={!canCreate}>
							{#if busy}
								<Loader2 class="size-3.5 animate-spin" /> Creating…
							{:else}
								Create changeset
							{/if}
						</Button>
					{/if}
				</div>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
