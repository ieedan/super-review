<script lang="ts">
	import { superForm, defaults } from 'sveltekit-superforms';
	import { zod as zod4, zodClient as zod4Client } from 'superforms-zod4-adapter';
	import { Control, Field } from 'formsnap';
	import { waitlistSchema } from '$lib/schema';
	import { Button } from '@super-review/ui/components/ui/button';
	import { Input } from '@super-review/ui/components/ui/input';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';

	// The hero's waitlist signup. SuperForms in SPA mode validates the email with the
	// shared Zod schema client-side (no hand-rolled regex), then posts to the
	// /api/waitlist serverless function — which re-validates with the same schema.
	let { class: className = '' }: { class?: string } = $props();

	let done = $state(false);

	const form = superForm(defaults(zod4(waitlistSchema)), {
		SPA: true,
		validators: zod4Client(waitlistSchema),
		validationMethod: 'submit-only',
		customValidity: false,
		async onUpdate({ form: f }) {
			if (!f.valid) return;
			try {
				const res = await fetch('/api/waitlist', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ email: f.data.email })
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok || !data.ok) return;
				done = true;
			} catch {
				return;
			}
		}
	});

	const { form: formData, enhance, submitting } = form;
</script>

<div class="waitlist-slot @container relative w-full {className}">
	<form
		method="POST"
		use:enhance
		novalidate
		class="waitlist-form flex w-full flex-col items-center gap-2"
		class:waitlist-form-done={done}
		aria-hidden={done}
	>
		<Field {form} name="email">
			<div
				class="border-line bg-elevated/60 flex w-full flex-col gap-2 rounded-xl border p-2 @min-[24rem]:flex-row @min-[24rem]:items-stretch @min-[24rem]:border-0 @min-[24rem]:bg-transparent @min-[24rem]:p-0"
			>
				<Control>
					{#snippet children({ props })}
						<Input
							{...props}
							type="email"
							autocomplete="email"
							placeholder="Your email address"
							bind:value={$formData.email}
							aria-invalid={undefined}
							tabindex={done ? -1 : undefined}
							class="bg-elevated/60 text-foreground focus-visible:ring-0 h-11 w-full rounded-xl border border-line text-base focus-visible:border-ring @min-[24rem]:flex-1"
						/>
					{/snippet}
				</Control>
				<Button
					type="submit"
					size="lg"
					class="h-11 w-full rounded-xl px-5 @min-[24rem]:w-auto"
					disabled={$submitting || done}
					tabindex={done ? -1 : undefined}
				>
					{#if $submitting}
						<LoaderCircle class="size-4 animate-spin" />
					{/if}
					Join Waitlist
				</Button>
			</div>
		</Field>
	</form>

	<p
		class="waitlist-success text-fg font-display pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-center text-base font-semibold tracking-tight whitespace-nowrap sm:text-xl"
		class:waitlist-success-visible={done}
		aria-hidden={!done}
	>
		<span>We'll let you know when it's <span class="flame-text">ready!</span></span>
	</p>
</div>

<style>
	.waitlist-form {
		transition: opacity 0.4s ease;
	}

	.waitlist-form-done {
		opacity: 0;
		pointer-events: none;
	}

	.waitlist-success {
		opacity: 0;
		transition: opacity 0.4s ease;
	}

	.waitlist-success-visible {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.waitlist-form,
		.waitlist-success {
			transition: none;
		}
	}
</style>
