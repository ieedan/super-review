<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod as zod4, zodClient as zod4Client } from 'superforms-zod4-adapter';
	import { Control, Field, FieldErrors } from 'formsnap';
	import { waitlistSchema } from '$lib/schema';
	import { Button } from '@super-review/ui/components/ui/button';
	import { Input } from '@super-review/ui/components/ui/input';
	import Check from '@lucide/svelte/icons/check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';

	// The hero's waitlist signup. SuperForms in SPA mode validates the email with the
	// shared Zod schema client-side (no hand-rolled regex), then posts to the
	// /api/waitlist serverless function — which re-validates with the same schema.
	let { class: className = '' }: { class?: string } = $props();

	let done = $state(false);

	const form = superForm(defaults(zod4(waitlistSchema)), {
		SPA: true,
		validators: zod4Client(waitlistSchema),
		async onUpdate({ form: f }) {
			if (!f.valid) return;
			try {
				const res = await fetch('/api/waitlist', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email: f.data.email })
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok || !data.ok) {
					f.errors.email = [data.error ?? 'Something went wrong. Please try again.'];
					return;
				}
				done = true;
			} catch {
				f.errors.email = ['Network error. Please try again.'];
			}
		}
	});

	const { form: formData, enhance, submitting } = form;
</script>

{#if done}
	<div
		class="border-line bg-elevated/60 flex items-center gap-3 rounded-xl border px-5 py-3.5 {className}"
	>
		<span class="bg-flame/15 text-flame grid size-6 shrink-0 place-items-center rounded-full">
			<Check class="size-3.5" />
		</span>
		<div class="text-left leading-tight">
			<p class="text-fg text-sm font-semibold">You're on the list.</p>
			<p class="text-muted-foreground text-xs">We'll email you when Super Review is ready.</p>
		</div>
	</div>
{:else}
	<form method="POST" use:enhance class="flex w-full flex-col items-center gap-2 {className}">
		<Field {form} name="email">
			<div class="flex w-full items-stretch gap-2">
				<Control>
					{#snippet children({ props })}
						<Input
							{...props}
							type="email"
							autocomplete="email"
							placeholder="Your email address"
							bind:value={$formData.email}
							class="bg-elevated/60 text-foreground h-11 flex-1 rounded-xl text-base"
						/>
					{/snippet}
				</Control>
				<Button type="submit" size="lg" class="h-11 rounded-xl px-5" disabled={$submitting}>
					{#if $submitting}
						<LoaderCircle class="size-4 animate-spin" />
					{/if}
					Join Waitlist
				</Button>
			</div>
			<FieldErrors class="text-destructive mt-1 self-start text-xs empty:hidden">
				{#snippet children({ errors })}
					{#each errors as err (err)}
						<span>{err}</span>
					{/each}
				{/snippet}
			</FieldErrors>
		</Field>
	</form>
{/if}
