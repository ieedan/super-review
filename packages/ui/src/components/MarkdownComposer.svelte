<script lang="ts">
	import { MarkdownEditor } from 'carta-md';
	import { getCarta, CARTA_THEME } from '@super-review/ui/carta';
	import { app } from '@super-review/ui/store.svelte';
	import 'carta-md/default.css';
	import '@super-review/ui/carta-theme.css';

	// GitHub-style markdown editor for PR comments — a thin wrapper over Carta's
	// <MarkdownEditor> wired to this app's shared `carta` instance and "github"
	// theme. Defaults to `tabs` mode (Write/Preview), matching GitHub's composer.
	interface Props {
		value: string;
		placeholder?: string;
		disabled?: boolean;
		autofocus?: boolean;
		// Bubbled-up keydown from the editor so callers can wire ⌘⏎ submit / Esc
		// cancel, mirroring the previous plain-textarea behavior.
		onkeydown?: (e: KeyboardEvent) => void;
	}

	let {
		value = $bindable(''),
		placeholder = '',
		disabled = false,
		autofocus = false,
		onkeydown
	}: Props = $props();

	// Carta instance for the user's configured diff theme. `$derived` so changing
	// the diff theme in settings re-themes the composer (getCarta memoizes per id).
	const cartaInstance = $derived(getCarta(app.diffTheme));

	// Carta's `autoFocus` only fires on initial page load, so it misses an editor
	// that's mounted dynamically (e.g. expanding a reply prompt). Focus the
	// internal <textarea> imperatively once it exists — on the next frame, since
	// Carta renders the textarea during its own mount.
	let wrapper = $state<HTMLDivElement | null>(null);
	$effect(() => {
		if (!autofocus || !wrapper) return;
		const el = wrapper;
		const id = requestAnimationFrame(() => el.querySelector('textarea')?.focus());
		return () => cancelAnimationFrame(id);
	});
</script>

<!-- Keydown bubbles from Carta's internal <textarea>; the slash/emoji popups
     stop propagation when they handle a key, so shortcuts here don't fire while
     a menu is open. -->
<div class="markdown-composer" bind:this={wrapper} {onkeydown} role="presentation">
	<MarkdownEditor
		carta={cartaInstance}
		bind:value
		theme={CARTA_THEME}
		mode="tabs"
		{placeholder}
		textarea={{ disabled, autoFocus: autofocus }}
	/>
</div>

<style>
	/* Carta lays the editor out internally; the wrapper just owns the width so the
	   composer fills the annotation row. */
	.markdown-composer {
		width: 100%;
	}
	/* The editor body is greyed while disabled (submitting) to echo the old
	   textarea's disabled affordance. `:global` because the textarea lives inside
	   Carta's component, out of reach of this component's scoped styles. */
	:global(.markdown-composer:has(textarea:disabled)) {
		opacity: 0.6;
	}
</style>
