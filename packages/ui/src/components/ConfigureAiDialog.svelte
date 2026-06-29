<script lang="ts">
	import { untrack } from 'svelte';
	import Folder from '@lucide/svelte/icons/folder';
	import Info from '@lucide/svelte/icons/info';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import * as Dialog from './ui/dialog';
	import * as Tooltip from './ui/tooltip';
	import { Button } from './ui/button';
	import { Checkbox } from './ui/checkbox';
	import { RadioGroup, RadioGroupItem } from './ui/radio-group';
	import AgentsConventionIcon from './AgentsConventionIcon.svelte';
	import FileIcon from './FileIcon.svelte';
	import HarnessLogo from './HarnessLogo.svelte';
	import { actions, app } from '@super-review/ui/store.svelte';
	import { harnessLabel } from '@super-review/ui/harness-logos';
	import {
		AGENTS_CONVENTION_HARNESSES,
		AI_CONFIG_TARGETS,
		HARNESS_AI_PATHS,
		SKILL_FILES
	} from '@super-review/core/ai-config-paths';
	import type { AiConfigInstallItem, AiScope, TargetKind } from '@super-review/core/types';

	const conventionLabels = AGENTS_CONVENTION_HARNESSES.map((h) => harnessLabel(h)).join(', ');

	const STEPS = [
		{ title: 'Files', hint: 'Which files should we add to your project?' },
		{ title: 'Location', hint: 'Where should they be installed?' },
		{ title: 'Agents', hint: 'Which coding agents should be able to read them?' }
	];

	const open = $derived(app.aiConfigDialogOpen);

	// Step 1: what to install (both on by default).
	let installSkill = $state(true);
	let installSubagent = $state(true);
	// Step 2: where.
	let scope = $state<AiScope>('project');
	// Step 3: which targets. `.agents` on by default; the rest opt-in.
	let selectedTargets = $state<Record<TargetKind, boolean>>({
		standard: true,
		'claude-code': false,
		codex: false
	});
	let step = $state(1);
	let applying = $state(false);
	let failures = $state<string[]>([]);

	// Reset the wizard only on closed → open so a background status refresh never
	// wipes in-progress choices (mirrors ChangesetDialog).
	let wasOpen = false;
	$effect(() => {
		const isOpen = app.aiConfigDialogOpen;
		if (isOpen && !wasOpen) {
			untrack(() => {
				installSkill = true;
				installSubagent = true;
				scope = 'project';
				selectedTargets = { standard: true, 'claude-code': false, codex: false };
				step = 1;
				applying = false;
				failures = [];
			});
		}
		wasOpen = isOpen;
	});

	const anyArtifact = $derived(installSkill || installSubagent);
	// Codex carries only a subagent (its skill rides on `.agents`), so it's only
	// offered when a subagent is being installed.
	const visibleTargets = $derived(
		AI_CONFIG_TARGETS.filter((t) => t !== 'codex' || installSubagent)
	);
	const selectedTargetList = $derived(visibleTargets.filter((t) => selectedTargets[t]));

	// The (target, artifact) writes the current selection implies, skipping any
	// artifact a target doesn't carry (e.g. Codex has no skill of its own).
	const plannedItems = $derived.by(() => {
		const items: { target: TargetKind; artifact: 'skill' | 'subagent' }[] = [];
		for (const target of selectedTargetList) {
			const p = HARNESS_AI_PATHS[target];
			if (installSkill && p.skill) items.push({ target, artifact: 'skill' });
			if (installSubagent && p.subagent) items.push({ target, artifact: 'subagent' });
		}
		return items;
	});
	const canConfigure = $derived(plannedItems.length > 0 && !applying);

	function detectedFor(target: TargetKind): boolean {
		return app.aiConfigStatus?.targets.find((t) => t.target === target)?.harnessDetected ?? false;
	}

	// The repo-relative (project) or `~/`-prefixed (global) paths every current
	// selection would create, for the preview tree.
	const previewPaths = $derived.by(() => {
		const prefix = scope === 'global' ? '~/' : '';
		const paths: string[] = [];
		for (const { target, artifact } of plannedItems) {
			const loc = artifact === 'skill' ? HARNESS_AI_PATHS[target].skill : HARNESS_AI_PATHS[target].subagent;
			if (!loc) continue;
			const rel = scope === 'project' ? loc.project : loc.global;
			if (rel === null) continue;
			if (artifact === 'skill') {
				for (const f of SKILL_FILES) paths.push(`${prefix}${rel}/${f}`);
			} else {
				paths.push(`${prefix}${rel}`);
			}
		}
		return paths;
	});

	type TreeNode = { name: string; children: Map<string, TreeNode>; isFile: boolean };
	const previewTree = $derived.by(() => {
		const root: TreeNode = { name: '', children: new Map(), isFile: false };
		for (const full of previewPaths) {
			const parts = full.split('/').filter(Boolean);
			let node = root;
			parts.forEach((part, i) => {
				const isLast = i === parts.length - 1;
				let child = node.children.get(part);
				if (!child) {
					child = { name: part, children: new Map(), isFile: isLast };
					node.children.set(part, child);
				}
				node = child;
			});
		}
		// Flatten depth-first (folders before files, alphabetical) for a flat,
		// indented render without recursive snippets.
		const rows: { name: string; depth: number; isFile: boolean }[] = [];
		const walk = (n: TreeNode, depth: number) => {
			const kids = [...n.children.values()].sort((a, b) =>
				a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1
			);
			for (const k of kids) {
				rows.push({ name: k.name, depth, isFile: k.isFile });
				if (!k.isFile) walk(k, depth + 1);
			}
		};
		walk(root, 0);
		return rows;
	});

	function goto(target: number): void {
		if (target > 1 && !anyArtifact) return;
		step = Math.min(STEPS.length, Math.max(1, target));
	}

	function onOpenChange(v: boolean): void {
		if (!v && !applying) actions.closeAiConfigDialog();
	}

	function onSubmit(e: Event): void {
		e.preventDefault();
		if (applying) return;
		if (step < STEPS.length) {
			if (step === 1 && !anyArtifact) return;
			step += 1;
		} else {
			void submit();
		}
	}

	async function submit(): Promise<void> {
		if (!canConfigure) return;
		const items: AiConfigInstallItem[] = plannedItems.map(({ target, artifact }) => ({
			target,
			artifact,
			scope
		}));
		applying = true;
		failures = [];
		try {
			const result = await actions.applyAiConfig({ items });
			const failed = result?.results.filter((r) => !r.ok) ?? [];
			if (failed.length === 0) {
				actions.closeAiConfigDialog();
			} else {
				failures = failed.map(
					(f) => `${HARNESS_AI_PATHS[f.item.target].label} ${f.item.artifact}: ${f.error ?? 'failed'}`
				);
			}
		} finally {
			applying = false;
		}
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<!-- Fixed height (capped to the viewport) so stepping through the wizard, whose
	     steps have different natural heights, never resizes the dialog. -->
	<Dialog.Content class="flex h-[28rem] max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
		<Dialog.Header>
			<Dialog.Title class="text-base">Configure AI files</Dialog.Title>
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
							<div class="grid gap-2">
								<label
									for="ai-skill"
									class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5 transition-colors has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5"
								>
									<Checkbox
										id="ai-skill"
										checked={installSkill}
										onCheckedChange={(v) => (installSkill = v === true)}
									/>
									<span class="grid gap-0.5">
										<span class="text-sm font-medium">Skill</span>
										<span class="text-xs text-muted-foreground">
											Teaches agents how and when to record a review session here.
										</span>
									</span>
								</label>
								<label
									for="ai-subagent"
									class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5 transition-colors has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5"
								>
									<Checkbox
										id="ai-subagent"
										checked={installSubagent}
										onCheckedChange={(v) => (installSubagent = v === true)}
									/>
									<span class="grid gap-0.5">
										<span class="text-sm font-medium">Subagent</span>
										<span class="text-xs text-muted-foreground">
											The tour-author that turns a diff into a guided review tour.
										</span>
									</span>
								</label>
								{#if !anyArtifact}
									<p class="text-xs text-destructive">Select at least one file to continue.</p>
								{/if}
							</div>
						{:else if step === 2}
							<RadioGroup bind:value={scope} class="grid gap-2">
								<label
									for="ai-scope-project"
									class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5 transition-colors has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5"
								>
									<RadioGroupItem id="ai-scope-project" value="project" class="mt-0.5" />
									<span class="grid gap-0.5">
										<span class="text-sm font-medium">This project</span>
										<span class="text-xs text-muted-foreground">
											Writes into the repository so your team shares the setup.
										</span>
									</span>
								</label>
								<label
									for="ai-scope-global"
									class="flex cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2.5 transition-colors has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5"
								>
									<RadioGroupItem id="ai-scope-global" value="global" class="mt-0.5" />
									<span class="grid gap-0.5">
										<span class="text-sm font-medium">Global</span>
										<span class="text-xs text-muted-foreground">
											Writes into your home directory for use across all projects.
										</span>
									</span>
								</label>
							</RadioGroup>
						{:else}
							<div class="grid gap-2">
								{#each visibleTargets as target (target)}
									<label
										for={`ai-target-${target}`}
										class="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2.5 transition-colors has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5"
									>
										<Checkbox
											id={`ai-target-${target}`}
											checked={selectedTargets[target] ?? false}
											onCheckedChange={(v) => (selectedTargets[target] = v === true)}
										/>
										{#if target === 'standard'}
											<AgentsConventionIcon size={22} />
										{:else}
											<HarnessLogo harness={target} size={20} class="shrink-0" />
										{/if}
										<span class="flex min-w-0 flex-1 items-center gap-1.5">
											<span class="truncate text-sm font-medium">
												{HARNESS_AI_PATHS[target].label}
											</span>
											{#if target === 'codex'}
												<span
													class="shrink-0 text-[11px] text-muted-foreground"
													title="Codex reads the skill from .agents; its subagent installs as a .codex/agents TOML file."
												>
													subagent only
												</span>
											{/if}
										</span>
										{#if target === 'standard'}
											<Tooltip.Provider delayDuration={150}>
												<Tooltip.Root>
													<Tooltip.Trigger
														type="button"
														class="text-muted-foreground hover:text-foreground"
														onclick={(e: MouseEvent) => e.preventDefault()}
													>
														<Info class="size-3.5" />
													</Tooltip.Trigger>
													<Tooltip.Content class="max-w-56 text-xs">
														Read by {conventionLabels}. One install covers them all.
													</Tooltip.Content>
												</Tooltip.Root>
											</Tooltip.Provider>
										{:else if detectedFor(target)}
											<span
												class="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
												title="This agent looks installed on your machine"
											>
												detected
											</span>
										{/if}
									</label>
								{/each}
								{#if selectedTargetList.length === 0}
									<p class="text-xs text-destructive">Select at least one agent to continue.</p>
								{/if}
							</div>
						{/if}
					</div>

					{#if failures.length > 0}
						<div
							class="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs"
						>
							<p class="font-medium text-destructive">Some files could not be written:</p>
							<ul class="mt-1 list-disc pl-4 text-muted-foreground">
								{#each failures as f (f)}
									<li>{f}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>

				<!-- Right: live preview of the files that will be created -->
				<div class="flex min-h-0 min-w-0 flex-col gap-2 pl-4">
					<span class="text-xs font-medium text-muted-foreground">
						Files to create ({previewPaths.length})
					</span>
					<div class="min-h-0 flex-1 overflow-auto rounded-md border border-border p-2">
						{#if previewTree.length === 0}
							<p class="px-1 py-2 text-xs text-muted-foreground">
								Nothing selected yet. Pick files and agents to preview where they'll be created.
							</p>
						{:else}
							<ul class="grid gap-0.5 font-mono text-xs">
								{#each previewTree as node, i (`${i}-${node.depth}-${node.name}`)}
									<li
										class="flex items-center gap-1.5 py-0.5"
										style={`padding-left: ${node.depth * 0.9 + 0.25}rem`}
									>
										{#if node.isFile}
											<FileIcon path={node.name} class="size-3.5 shrink-0" />
											<span class="truncate text-foreground">{node.name}</span>
										{:else}
											<Folder class="size-3.5 shrink-0 text-muted-foreground" />
											<span class="truncate text-muted-foreground">{node.name}/</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				</div>
			</div>

			<Dialog.Footer class="sm:justify-between">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={applying}
					onclick={() => actions.closeAiConfigDialog()}
				>
					Cancel
				</Button>
				<div class="flex gap-2">
					{#if step > 1}
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={applying}
							onclick={() => goto(step - 1)}
						>
							Back
						</Button>
					{/if}
					{#if step < STEPS.length}
						<Button type="submit" size="sm" disabled={step === 1 && !anyArtifact}>Next</Button>
					{:else}
						<Button type="submit" size="sm" disabled={!canConfigure}>
							{#if applying}
								<Loader2 class="size-3.5 animate-spin" /> Configuring…
							{:else}
								Configure
							{/if}
						</Button>
					{/if}
				</div>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
