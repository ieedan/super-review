<script lang="ts">
	// Settings → Prompts: the instruction half of everything the agent CLIs are
	// asked to write. Each editor holds only what the user cares about: the change
	// context (branch, files, patch, packages) and the required output format are
	// appended by the main process and are not editable here.
	//
	// Which CLI and model run these lives in Settings → Agents; only the wording
	// differs between the two.
	import { Button } from './ui/button';
	import { Textarea } from './ui/textarea';
	import { actions, app } from '@super-review/ui/store.svelte';
	import { DEFAULT_COMMIT_MESSAGE_BASE_PROMPT } from '@super-review/core/commit-message-prompt';
	import { DEFAULT_CHANGESET_BASE_PROMPT } from '@super-review/core/changeset-prompt';

	// Held as drafts and written on blur so every keystroke isn't a disk write; an
	// empty box means "use the default".
	let commitDraft = $state(
		app.prefs?.commitMessagePrompt?.trim() || DEFAULT_COMMIT_MESSAGE_BASE_PROMPT
	);
	let changesetDraft = $state(app.prefs?.changesetPrompt?.trim() || DEFAULT_CHANGESET_BASE_PROMPT);

	const commitIsDefault = $derived(commitDraft.trim() === DEFAULT_COMMIT_MESSAGE_BASE_PROMPT);
	const changesetIsDefault = $derived(changesetDraft.trim() === DEFAULT_CHANGESET_BASE_PROMPT);

	async function persistCommitPrompt(): Promise<void> {
		const next = commitDraft.trim();
		const current = app.prefs?.commitMessagePrompt?.trim() || DEFAULT_COMMIT_MESSAGE_BASE_PROMPT;
		if (next === current) return;
		await actions.setCommitMessagePrompt(next === DEFAULT_COMMIT_MESSAGE_BASE_PROMPT ? '' : next);
	}

	async function persistChangesetPrompt(): Promise<void> {
		const next = changesetDraft.trim();
		const current = app.prefs?.changesetPrompt?.trim() || DEFAULT_CHANGESET_BASE_PROMPT;
		if (next === current) return;
		await actions.setChangesetPrompt(next === DEFAULT_CHANGESET_BASE_PROMPT ? '' : next);
	}
</script>

<div class="space-y-8">
	<section id="settings-commit-message-prompt" class="scroll-mt-4 space-y-2">
		<div class="flex items-end justify-between gap-3">
			<div>
				<h3 class="text-base font-semibold">Commit message</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					Your instructions for the sparkle in the commit box. The branch, the staged files, the
					patch, and the output format are added automatically.
				</p>
			</div>
			{#if !commitIsDefault}
				<Button
					variant="ghost"
					size="sm"
					class="shrink-0"
					onclick={() => {
						commitDraft = DEFAULT_COMMIT_MESSAGE_BASE_PROMPT;
						void persistCommitPrompt();
					}}
				>
					Reset
				</Button>
			{/if}
		</div>
		<Textarea
			bind:value={commitDraft}
			onblur={() => void persistCommitPrompt()}
			rows={4}
			class="resize-none text-xs leading-snug"
			placeholder={DEFAULT_COMMIT_MESSAGE_BASE_PROMPT}
		/>
	</section>

	<section id="settings-changeset-prompt" class="scroll-mt-4 space-y-2">
		<div class="flex items-end justify-between gap-3">
			<div>
				<h3 class="text-base font-semibold">Changeset</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					Your instructions for the sparkle on the “Add a changeset?” prompt. Describe what a
					changeset should read like. How many to write and which packages each one covers is up to
					the agent, which sees the branch and your releasable packages.
				</p>
			</div>
			{#if !changesetIsDefault}
				<Button
					variant="ghost"
					size="sm"
					class="shrink-0"
					onclick={() => {
						changesetDraft = DEFAULT_CHANGESET_BASE_PROMPT;
						void persistChangesetPrompt();
					}}
				>
					Reset
				</Button>
			{/if}
		</div>
		<Textarea
			bind:value={changesetDraft}
			onblur={() => void persistChangesetPrompt()}
			rows={4}
			class="resize-none text-xs leading-snug"
			placeholder={DEFAULT_CHANGESET_BASE_PROMPT}
		/>
	</section>
</div>
