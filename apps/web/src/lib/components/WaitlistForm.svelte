<script lang="ts">
	import { Button } from '@super-review/ui/components/ui/button';
	import { Input } from '@super-review/ui/components/ui/input';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import { useConvexClient } from '$lib/convex.svelte';
	import { api } from '$lib/convex/_generated/api';
	import { waitlistSchema } from '$lib/schema';

	// The hero's waitlist signup. An email is the whole cost of entry: it grants
	// nothing on its own, and access arrives later as an invite code mailed to
	// this address. Validates with the shared Zod schema so the field can
	// complain before a round trip; the Convex mutation re-validates.
	//
	// "I already have a code" sits under both the form and the success state so
	// someone who got an invite from a friend can leave the waitlist path without
	// hunting for another entry point.
	//
	// `align` controls horizontal alignment: the hero is left-aligned with the
	// input on large screens; the bottom-of-page form stays centred under its heading.
	let { class: className = '', align = 'center' }: { class?: string; align?: 'start' | 'center' } =
		$props();

	const convex = useConvexClient();

	let email = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);
	let done = $state(false);

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (submitting || done) return;

		const parsed = waitlistSchema.safeParse({ email });
		if (!parsed.success) {
			error = parsed.error.issues[0]?.message ?? 'Enter a valid email address.';
			return;
		}

		submitting = true;
		error = null;
		const res = await convex.safeMutation(api.waitlist.join, { email: parsed.data.email });
		submitting = false;

		if (res.isErr()) {
			if (res.error.code === 'RATE_LIMITED') {
				error = 'Too many attempts. Wait a bit and try again.';
			} else if (res.error.code === 'INVALID_EMAIL') {
				error = 'Enter a valid email address.';
			} else {
				error = 'Something went wrong. Please try again.';
			}
			return;
		}
		done = true;
	}
</script>

<div
	class="waitlist-slot @container relative flex w-full flex-col items-center gap-1.5 {className}"
	class:lg:items-start={align === 'start'}
>
	<div class="relative w-full">
		<form
			onsubmit={submit}
			novalidate
			class="waitlist-form flex w-full flex-col items-center gap-2"
			class:waitlist-form-done={done}
			aria-hidden={done}
		>
			<div
				class="border-line bg-elevated/60 flex w-full flex-col gap-2 rounded-xl border p-2 @min-[24rem]:flex-row @min-[24rem]:items-stretch @min-[24rem]:border-0 @min-[24rem]:bg-transparent @min-[24rem]:p-0"
			>
				<Input
					type="email"
					name="email"
					autocomplete="email"
					placeholder="Your email address"
					aria-label="Email address"
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={error ? 'waitlist-error' : undefined}
					bind:value={email}
					oninput={() => (error = null)}
					tabindex={done ? -1 : undefined}
					class="bg-elevated/60 text-foreground border-line focus-visible:border-ring h-11 w-full rounded-xl border text-base focus-visible:ring-0 @min-[24rem]:flex-1"
				/>
				<Button
					type="submit"
					size="lg"
					class="h-11 w-full rounded-xl px-5 @min-[24rem]:w-auto"
					disabled={submitting || done}
					tabindex={done ? -1 : undefined}
				>
					{#if submitting}
						<LoaderCircle class="size-4 animate-spin" />
					{/if}
					Join Waitlist
				</Button>
			</div>

			{#if error}
				<p id="waitlist-error" class="text-destructive w-full text-left text-sm">{error}</p>
			{/if}
		</form>

		<p
			class="text-fg font-display waitlist-success pointer-events-none absolute inset-0 flex items-center justify-center text-center text-base font-semibold tracking-tight whitespace-nowrap sm:text-xl"
			class:lg:justify-start={align === 'start'}
			class:lg:text-left={align === 'start'}
			class:waitlist-success-visible={done}
			aria-hidden={!done}
		>
			<span>We'll send your invite when it's <span class="flame-text">ready!</span></span>
		</p>
	</div>

	<p class="text-xs">
		<a
			href="/invite"
			class="text-muted-foreground hover:text-fg underline-offset-2 hover:underline"
		>
			I already have a code
		</a>
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
