<script lang="ts">
	import { onMount } from 'svelte';
	import Download from '@lucide/svelte/icons/download';
	import FolderOpen from '@lucide/svelte/icons/folder-open';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from './ui/button';
	import { confirmDelete } from './ui/confirm-delete-dialog';
	import AgentsConventionIcon from './AgentsConventionIcon.svelte';
	import HarnessLogo from './HarnessLogo.svelte';
	import { actions, app } from '@super-review/ui/store.svelte';
	import {
		AI_CONFIG_TARGETS,
		BUNDLED_SKILLS,
		HARNESS_AI_PATHS
	} from '@super-review/core/ai-config-paths';
	import type { AiArtifact, AiArtifactStatus, AiScope, TargetKind } from '@super-review/core/types';

	// Re-detect on open so the panel reflects files that changed on disk since the
	// last repo switch / install.
	onMount(() => {
		void actions.refreshAiConfigStatus();
	});

	const status = $derived(app.aiConfigStatus);

	const SCOPES: { key: AiScope; label: string; hint: string }[] = [
		{ key: 'project', label: 'This project', hint: 'Installed in the current repository.' },
		{ key: 'global', label: 'Global', hint: 'Installed in your home directory, for all projects.' }
	];

	const ARTIFACT_LABELS: Record<AiArtifact, string> = { skill: 'Skill', subagent: 'Subagent' };

	// `skill` carries the bundled skill's directory name for skill rows (needed to
	// reinstall/update or remove the right one); it's undefined for subagent rows.
	type Row = { target: TargetKind; artifact: AiArtifact; slot: AiArtifactStatus; skill?: string };

	// The installed skill/subagent files at a given scope, across every target. Each
	// bundled skill is its own row so it can be updated or removed independently.
	function rowsForScope(scope: AiScope): Row[] {
		const rows: Row[] = [];
		for (const target of AI_CONFIG_TARGETS) {
			const t = status?.targets.find((x) => x.target === target);
			if (!t) continue;
			for (const skill of t.skills ?? []) {
				const slot = skill[scope];
				if (slot && slot.installed)
					rows.push({ target, artifact: 'skill', slot, skill: skill.name });
			}
			const sub = t.subagent ? t.subagent[scope] : null;
			if (sub && sub.installed) rows.push({ target, artifact: 'subagent', slot: sub });
		}
		return rows;
	}

	// One group per skill / subagent, each holding the per-harness rows that install
	// it. Groups are ordered bundled-skills-first (in their declared order) then the
	// subagent; rows inside keep the `AI_CONFIG_TARGETS` order from `rowsForScope`.
	// A row's group is its skill name, or `subagent` for the tour-author file.
	type Group = { key: string; label: string; rows: Row[] };

	const groupKey = (row: Row): string =>
		row.artifact === 'skill' ? `skill:${row.skill}` : 'subagent';

	function groupsForScope(scope: AiScope): Group[] {
		const order: Group[] = [
			...BUNDLED_SKILLS.map((s) => ({ key: `skill:${s.name}`, label: s.label, rows: [] as Row[] })),
			{ key: 'subagent', label: ARTIFACT_LABELS.subagent, rows: [] }
		];
		const byKey = new Map(order.map((g) => [g.key, g]));
		for (const row of rowsForScope(scope)) byKey.get(groupKey(row))?.rows.push(row);
		return order.filter((g) => g.rows.length > 0);
	}

	const projectGroups = $derived(groupsForScope('project'));
	const globalGroups = $derived(groupsForScope('global'));

	// Show project paths relative to the repo root; show global paths absolute.
	function displayPath(abs: string, scope: AiScope): string {
		const repo = app.activeRepo?.path;
		if (scope === 'project' && repo && abs.startsWith(repo)) {
			return abs.slice(repo.length).replace(/^[/\\]/, '');
		}
		return abs;
	}

	function openConfigure(): void {
		// Close settings first so the wizard isn't stacked behind this dialog.
		actions.closeSettingsDialog();
		actions.openAiConfigDialog();
	}

	function confirmRemove(row: Row, scope: AiScope): void {
		const label = HARNESS_AI_PATHS[row.target].label;
		const artifact = ARTIFACT_LABELS[row.artifact].toLowerCase();
		const where = scope === 'project' ? 'this project' : 'your home directory';
		confirmDelete({
			title: `Delete the ${label} ${artifact}?`,
			description: `Removes the ${artifact} files from ${where}. You can reinstall them anytime from Configure. This can't be undone.`,
			icon: 'warning',
			details: { caption: 'Path', value: row.slot.path },
			confirm: { text: 'Delete' },
			onConfirm: async () => {
				await actions.removeAiConfig({
					target: row.target,
					artifact: row.artifact,
					scope,
					...(row.skill ? { skill: row.skill } : {})
				});
			}
		});
	}

	// Tracks which rows are mid-update so the button shows progress and can't be
	// double-clicked. Keyed the same way as the row `#each`.
	let updating = $state<Record<string, boolean>>({});
	const rowKey = (row: Row, scope: AiScope): string =>
		`${scope}:${row.target}:${row.artifact}:${row.skill ?? ''}`;

	// Re-install the bundled copy over the installed one, upgrading it to the
	// current version. Same write the Configure dialog performs for this one item.
	async function updateRow(row: Row, scope: AiScope): Promise<void> {
		const key = rowKey(row, scope);
		if (updating[key]) return;
		updating[key] = true;
		try {
			await actions.applyAiConfig({
				items: [
					{
						target: row.target,
						artifact: row.artifact,
						scope,
						...(row.skill ? { skill: row.skill } : {})
					}
				]
			});
		} finally {
			updating[key] = false;
		}
	}
</script>

<section class="space-y-6">
	<div class="flex items-start justify-between gap-3">
		<div>
			<h3 class="text-base font-semibold">Agent files</h3>
			<p class="mt-1 text-xs text-muted-foreground">
				The super-review skills and tour-author subagent installed for your coding agents, and where
				each one lives on disk.
			</p>
		</div>
		<Button variant="outline" size="sm" class="shrink-0" onclick={openConfigure}>
			<Settings2 class="size-3.5" />
			Configure…
		</Button>
	</div>

	{#if !status}
		<p class="text-sm text-muted-foreground">Open a repository to manage its agent files.</p>
	{:else}
		{#each SCOPES as s (s.key)}
			{@const groups = s.key === 'project' ? projectGroups : globalGroups}
			<div>
				<h4 class="text-sm font-medium">{s.label}</h4>
				<p class="mt-0.5 text-xs text-muted-foreground">{s.hint}</p>
				<div class="mt-3 space-y-4">
					{#if groups.length === 0}
						<p
							class="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground"
						>
							Nothing installed here yet.
						</p>
					{:else}
						{#each groups as group (group.key)}
							<div>
								<h5 class="mb-1.5 text-xs font-medium text-muted-foreground">{group.label}</h5>
								<div class="space-y-1.5">
									{#each group.rows as row (`${row.target}:${row.artifact}:${row.skill ?? ''}`)}
										<div
											class="flex items-center gap-2.5 rounded-md border border-border px-3 py-2"
										>
											{#if row.target === 'standard'}
												<AgentsConventionIcon size={18} />
											{:else}
												<HarnessLogo harness={row.target} size={18} class="shrink-0" />
											{/if}
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-1.5 text-sm leading-tight">
													<span class="font-medium">{HARNESS_AI_PATHS[row.target].label}</span>
													{#if row.slot.updateAvailable}
														{@const key = rowKey(row, s.key)}
														<button
															type="button"
															class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
															title="A newer version is bundled with the app. Click to update."
															disabled={updating[key]}
															onclick={() => updateRow(row, s.key)}
														>
															<Download class="size-2.5 {updating[key] ? 'animate-pulse' : ''}" />
															{updating[key] ? 'updating…' : 'update available'}
														</button>
													{/if}
												</div>
												<div
													class="truncate font-mono text-[11px] text-muted-foreground"
													title={row.slot.path}
												>
													{displayPath(row.slot.path, s.key)}
												</div>
											</div>
											<div class="flex shrink-0 items-center gap-1">
												<Button
													variant="ghost"
													size="sm"
													title="Reveal in file manager"
													onclick={() => actions.revealPath(row.slot.path)}
												>
													<FolderOpen class="size-3.5" />
													Reveal
												</Button>
												<Button
													variant="ghost"
													size="icon-sm"
													class="text-muted-foreground hover:text-destructive"
													title="Delete from disk"
													onclick={() => confirmRemove(row, s.key)}
												>
													<Trash2 class="size-3.5" />
												</Button>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</div>
		{/each}
	{/if}
</section>
