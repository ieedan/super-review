import { untrack } from 'svelte';
import { actions, app } from '@super-review/ui/store.svelte';
import { formatClaudeModelLabel } from '@super-review/core/model-label';
import type { CommitMessageHarness, CommitMessageModelOption } from '@super-review/core/types';

export interface CommitMessageModelPicker {
	readonly models: CommitMessageModelOption[];
	readonly selected: string;
	readonly selectedLabel: string;
	select(id: string): Promise<void>;
}

/**
 * Shared state for the commit message model pickers: the model list, the pinned
 * selection, and the background refresh. Every picker reads straight from the
 * store's cache, which is prefetched on launch (and backed by an on-disk cache in
 * main), so the list is already there when the picker opens.
 */
export function createCommitMessageModelPicker(opts: {
	harness: () => CommitMessageHarness | null;
	open: () => boolean;
}): CommitMessageModelPicker {
	let requestId = 0;

	const models = $derived.by(() => {
		const harness = opts.harness();
		return harness ? (app.commitMessageModels[harness] ?? []) : [];
	});

	const selected = $derived.by(() => {
		const harness = opts.harness();
		if (!harness) return '';
		return app.prefs?.commitMessageModels?.[harness] ?? models[0]?.id ?? '';
	});

	// A model pinned before the list changed shape (or picked under another
	// harness) won't match an item, so name it rather than showing the raw id.
	const selectedLabel = $derived(
		models.find((m) => m.id === selected)?.label ?? formatClaudeModelLabel(selected) ?? selected
	);

	// Refresh in the background. The list the user sees comes from the store cache,
	// so this never gates a paint; it only fills a never-listed harness or picks up
	// a newer list. Main serves from disk and revalidates stale entries itself.
	async function refresh(harness: CommitMessageHarness): Promise<void> {
		const id = ++requestId;
		const listed = await actions.listCommitMessageModels(harness);
		if (id !== requestId) return;
		const saved = app.prefs?.commitMessageModels?.[harness];
		if (!saved && listed[0]) {
			await actions.setCommitMessageModel(harness, listed[0].id);
		}
	}

	$effect(() => {
		const harness = opts.harness();
		const isOpen = opts.open();
		if (!harness) return;
		// Opening always revalidates; otherwise only fetch a harness the store has
		// never listed, so mounting a row per harness doesn't re-probe every CLI.
		if (!isOpen && app.commitMessageModels[harness]) return;
		// untrack: refresh writes the store's model cache, which this effect reads
		// above — untracked so it can't re-trigger itself.
		untrack(() => void refresh(harness));
	});

	return {
		get models() {
			return models;
		},
		get selected() {
			return selected;
		},
		get selectedLabel() {
			return selectedLabel;
		},
		async select(id: string): Promise<void> {
			const harness = opts.harness();
			if (!id || !harness) return;
			await actions.setCommitMessageModel(harness, id);
		}
	};
}
