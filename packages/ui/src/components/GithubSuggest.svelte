<script lang="ts">
	import type { Carta } from 'carta-md';
	import { onDestroy, onMount } from 'svelte';
	import type { TransitionConfig } from 'svelte/transition';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import GitPullRequestClosed from '@lucide/svelte/icons/git-pull-request-closed';
	import GitPullRequestDraft from '@lucide/svelte/icons/git-pull-request-draft';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import { fetchMentionableUsers, fetchIssueReferences } from '@super-review/ui/github-suggest';
	import type { IssueReference, MentionableUser } from '@super-review/core/types';

	// GitHub-style @mention / #reference typeahead for the markdown composer. One
	// instance per trigger is registered as a Carta `input` component (see
	// carta.ts), so it mounts alongside the emoji picker and is handed the shared
	// `carta` instance. Modeled on @cartamd/plugin-emoji's popup: it listens on
	// carta's <textarea>, and `carta.bindToCaret` teleports the list to <body> and
	// tracks the caret. The data comes from github-suggest.ts (the GitHub API via
	// the preload bridge); we filter it client-side as the user types.

	interface Props {
		carta: Carta;
		kind: 'mention' | 'issue';
		inTransition?: (node: Element) => TransitionConfig;
		outTransition?: (node: Element) => TransitionConfig;
		maxResults?: number;
	}

	let {
		carta,
		kind,
		inTransition = () => ({ duration: 0 }),
		outTransition = () => ({ duration: 0 }),
		maxResults = 8
	}: Props = $props();

	type SuggestItem = MentionableUser | IssueReference;

	const trigger = $derived(kind === 'mention' ? '@' : '#');

	let visible = $state(false);
	let filter = $state('');
	// Index of the trigger char (`@`/`#`) in the textarea value; the query is
	// everything between it and the caret.
	let triggerPos = 0;
	let hoveringIndex = $state(0);
	let base: SuggestItem[] = $state([]);
	let items: SuggestItem[] = $state([]);
	let buttons: HTMLButtonElement[] = $state([]);
	// Bumped on every fetch so a slow response can't overwrite a newer query.
	let loadToken = 0;
	let refetchTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(() => {
		const ta = carta.input?.textarea;
		if (!ta) return;
		ta.addEventListener('keydown', handleKeyDown);
		ta.addEventListener('input', handleKeyInput);
		ta.addEventListener('click', hide);
		ta.addEventListener('blur', hideAfterDelay);
	});

	onDestroy(() => {
		const ta = carta.input?.textarea;
		ta?.removeEventListener('keydown', handleKeyDown);
		ta?.removeEventListener('input', handleKeyInput);
		ta?.removeEventListener('click', hide);
		ta?.removeEventListener('blur', hideAfterDelay);
		if (refetchTimer) clearTimeout(refetchTimer);
	});

	function hide() {
		visible = false;
	}

	// A click on a suggestion blurs the textarea; delay hiding so the button's
	// onclick fires first (matching the emoji picker). Ignore blur that keeps
	// focus in the editor's own textarea (id "md").
	function hideAfterDelay() {
		const el = document.activeElement;
		if (el && el.tagName === 'TEXTAREA' && el.id === 'md') return;
		setTimeout(hide, 250);
	}

	async function load(query?: string) {
		const token = ++loadToken;
		const result =
			kind === 'mention' ? await fetchMentionableUsers() : await fetchIssueReferences(query);
		if (token !== loadToken || !visible) return;
		base = result ?? [];
		applyFilter();
	}

	function scheduleRefetch(query: string) {
		if (refetchTimer) clearTimeout(refetchTimer);
		refetchTimer = setTimeout(() => void load(query), 150);
	}

	function applyFilter() {
		const f = filter.trim().toLowerCase();
		if (kind === 'mention') {
			const users = base as MentionableUser[];
			const matched = f ? users.filter((u) => u.login.toLowerCase().startsWith(f)) : users;
			items = matched.slice(0, maxResults);
		} else {
			const issues = base as IssueReference[];
			let matched: IssueReference[];
			if (!f) matched = issues;
			else if (/^\d+$/.test(f)) matched = issues.filter((i) => String(i.number).startsWith(f));
			else matched = issues.filter((i) => i.title.toLowerCase().includes(f));
			items = matched.slice(0, maxResults);
		}
		hoveringIndex = 0;
	}

	function handleKeyInput(e: Event) {
		const input = carta.input;
		if (!input) return;
		const ev = e as InputEvent;
		const ta = input.textarea;

		// Opening the popup: a freshly typed trigger char at a word boundary. The
		// boundary (start of text / whitespace / opening bracket) is what keeps
		// `C#`, `foo@bar`, and mid-word `#` from triggering.
		if (ev.inputType === 'insertText' && ev.data === trigger) {
			const pos = ta.selectionStart - 1;
			const prev = pos > 0 ? ta.value[pos - 1] : '';
			if (pos === 0 || /[\s([{]/.test(prev)) {
				visible = true;
				triggerPos = pos;
				filter = '';
				base = [];
				items = [];
				hoveringIndex = 0;
				void load();
			} else {
				visible = false;
			}
			return;
		}

		if (!visible) return;

		// Caret moved to or before the trigger (e.g. the trigger was deleted).
		if (ta.selectionStart <= triggerPos) {
			visible = false;
			return;
		}

		if (
			ev.inputType === 'insertText' ||
			ev.inputType === 'insertCompositionText' ||
			ev.inputType === 'deleteContentBackward'
		) {
			filter = ta.value.slice(triggerPos + 1, ta.selectionStart);
			// A character that can't belong to the token ends the mention/reference:
			// mentions accept only username chars; references stop at a newline (or a
			// runaway-long title query).
			const invalid =
				kind === 'mention'
					? /[^a-zA-Z0-9-]/.test(filter)
					: /[\n\r]/.test(filter) || filter.length > 60;
			if (invalid) {
				visible = false;
				return;
			}
			applyFilter();
			// A number we don't already have locally: ask the main process to resolve
			// that exact issue/PR (it prepends it), so older numbers are referenceable.
			if (kind === 'issue' && /^\d+$/.test(filter) && items.length === 0) {
				scheduleRefetch(filter);
			}
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (!visible) return;
		// Stop these from reaching the composer wrapper (⌘⏎ submit / Esc cancel)
		// while the popup owns the keystroke.
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			visible = false;
		} else if (e.key === 'ArrowDown') {
			if (!items.length) return;
			e.preventDefault();
			e.stopPropagation();
			hoveringIndex = (hoveringIndex + 1) % items.length;
		} else if (e.key === 'ArrowUp') {
			if (!items.length) return;
			e.preventDefault();
			e.stopPropagation();
			hoveringIndex = (hoveringIndex - 1 + items.length) % items.length;
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			if (!items.length) return;
			e.preventDefault();
			e.stopPropagation();
			select(items[hoveringIndex]);
		}
	}

	function select(item: SuggestItem) {
		const input = carta.input;
		if (!input) return;
		const text =
			kind === 'mention'
				? `@${(item as MentionableUser).login} `
				: `#${(item as IssueReference).number} `;
		input.removeAt(triggerPos, filter.length + 1);
		input.insertAt(triggerPos, text);
		const newPos = triggerPos + text.length;
		input.textarea.focus();
		input.textarea.setSelectionRange(newPos, newPos);
		input.update();
		visible = false;
	}

	// Icon + color for an issue/PR row, mirroring GitHub's status glyphs. All
	// lucide icons share one component type, so `typeof CircleDot` types them all.
	function issueIcon(i: IssueReference): { comp: typeof CircleDot; cls: string } {
		if (i.isPullRequest) {
			if (i.merged) return { comp: GitMerge, cls: 'carta-gh-merged' };
			if (i.state === 'closed') return { comp: GitPullRequestClosed, cls: 'carta-gh-closed' };
			if (i.draft) return { comp: GitPullRequestDraft, cls: 'carta-gh-secondary' };
			return { comp: GitPullRequest, cls: 'carta-gh-open' };
		}
		return i.state === 'closed'
			? { comp: CircleCheck, cls: 'carta-gh-merged' }
			: { comp: CircleDot, cls: 'carta-gh-open' };
	}

	// Keep the highlighted row in view as the arrow keys move through the list.
	$effect(() => {
		buttons[hoveringIndex]?.scrollIntoView({ block: 'nearest' });
	});
</script>

{#if visible && items.length > 0}
	<div class="carta-gh-suggest" in:inTransition out:outTransition use:carta.bindToCaret>
		{#each items as item, i (kind === 'mention' ? (item as MentionableUser).login : (item as IssueReference).number)}
			<button
				type="button"
				class:carta-active={i === hoveringIndex}
				bind:this={buttons[i]}
				onmousedown={(e) => e.preventDefault()}
				onclick={() => select(item)}
			>
				{#if kind === 'mention'}
					{@const u = item as MentionableUser}
					<img class="carta-gh-avatar" src={u.avatarUrl} alt="" />
					<span class="carta-gh-primary">{u.login}</span>
				{:else}
					{@const ref = item as IssueReference}
					{@const icon = issueIcon(ref)}
					{@const Icon = icon.comp}
					<span class="carta-gh-icon {icon.cls}"><Icon size={14} /></span>
					<span class="carta-gh-primary">#{ref.number}</span>
					<span class="carta-gh-secondary">{ref.title}</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}
