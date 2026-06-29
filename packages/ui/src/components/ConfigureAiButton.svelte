<script lang="ts">
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import { Button, type ButtonSize, type ButtonVariant } from './ui/button';
	import { actions } from '@super-review/ui/store.svelte';

	// Opens the "Configure AI files" dialog, where the user picks which coding
	// agents to set up (skill / subagent / both) and at which scope. Visibility is
	// the caller's call (e.g. the sessions empty state only shows it when nothing
	// is configured) — this is just the button. Size/variant/label are overridable
	// so it fits both the prominent empty state and the compact notice stack.
	let {
		size = 'sm',
		variant = 'outline',
		label = 'Configure',
		class: className
	}: {
		size?: ButtonSize;
		variant?: ButtonVariant;
		label?: string;
		class?: string;
	} = $props();
</script>

<Button onclick={() => actions.openAiConfigDialog()} {size} {variant} class={className}>
	<Settings2 class="size-3.5" />
	{label}
</Button>
