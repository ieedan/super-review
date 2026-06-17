<script lang="ts" module>
	// A single, app-wide confirmation dialog driven imperatively: call
	// `confirmDelete(options)` from anywhere and a `<ConfirmDeleteDialog />`
	// mounted once at the app root renders it. Adapted from
	// shadcn-svelte-extras' confirm-delete-dialog, with an added optional
	// checkbox (e.g. "also delete on the remote") whose state is handed to
	// `onConfirm`. `onConfirm` should reject/throw on failure so the dialog
	// stays open; resolving closes it.
	export type ConfirmDeleteOptions = {
		title: string;
		description: string;
		skipConfirmation?: boolean;
		// When 'warning', an amber warning triangle is shown to the left of the
		// body — GitHub Desktop-style for destructive, hard-to-undo actions.
		icon?: 'warning';
		// Optional detail block beneath the description: a caption line plus a
		// value rendered in a subdued monospace box (e.g. the repo's path).
		details?: { caption: string; value: string };
		// When set, the user must type `confirmationText` exactly before they can
		// confirm — a friction gate for especially destructive deletes.
		input?: { confirmationText: string };
		// When set, an extra opt-in checkbox is shown; its value is passed to
		// `onConfirm` as `checked`.
		checkbox?: { label: string; description?: string; default?: boolean };
		confirm?: { text?: string };
		cancel?: { text?: string };
		onConfirm: (result: { checked: boolean }) => Promise<unknown>;
		onCancel?: () => void;
	};

	class ConfirmDeleteDialogState {
		open = $state(false);
		inputText = $state('');
		checked = $state(false);
		loading = $state(false);
		options = $state<ConfirmDeleteOptions | null>(null);

		constructor() {
			this.confirm = this.confirm.bind(this);
			this.cancel = this.cancel.bind(this);
		}

		newConfirmation(options: ConfirmDeleteOptions): void {
			this.options = options;
			this.inputText = '';
			this.checked = options.checkbox?.default ?? false;
			this.loading = false;
			this.open = true;
		}

		get canConfirm(): boolean {
			if (this.loading) return false;
			if (this.options?.input) {
				return this.inputText === this.options.input.confirmationText;
			}
			return true;
		}

		confirm(): void {
			if (!this.options || !this.canConfirm) return;
			this.loading = true;
			Promise.resolve(this.options.onConfirm({ checked: this.checked }))
				.then(() => {
					this.open = false;
				})
				// A rejected onConfirm keeps the dialog open; the failure is surfaced
				// by the caller (e.g. an error toast).
				.catch(() => {})
				.finally(() => {
					this.loading = false;
				});
		}

		cancel(): void {
			this.options?.onCancel?.();
			this.open = false;
		}
	}

	const dialogState = new ConfirmDeleteDialogState();

	export function confirmDelete(options: ConfirmDeleteOptions): void {
		if (options.skipConfirmation) {
			void options.onConfirm({ checked: options.checkbox?.default ?? false });
			return;
		}
		dialogState.newConfirmation(options);
	}
</script>

<script lang="ts">
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { buttonVariants } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { cn } from '$lib/utils';
</script>

<AlertDialog.Root bind:open={dialogState.open}>
	<AlertDialog.Content>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				dialogState.confirm();
			}}
			class="flex flex-col gap-4"
		>
			<!-- GitHub Desktop-style layout: an optional warning icon sits in its
			     own column to the left of the title, body, and any extras. With no
			     icon the column spans the full width, so other callers are unchanged. -->
			<div class="flex gap-3">
				{#if dialogState.options?.icon === 'warning'}
					<TriangleAlert class="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
				{/if}
				<div class="flex min-w-0 flex-1 flex-col gap-4">
					<AlertDialog.Header>
						<AlertDialog.Title>{dialogState.options?.title}</AlertDialog.Title>
						<AlertDialog.Description>
							{dialogState.options?.description}
						</AlertDialog.Description>
					</AlertDialog.Header>

					{#if dialogState.options?.details}
						{@const d = dialogState.options.details}
						<div class="grid gap-1.5 text-left">
							<span class="text-sm text-muted-foreground">{d.caption}</span>
							<code
								title={d.value}
								class="truncate rounded-md border border-border bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground"
							>
								{d.value}
							</code>
						</div>
					{/if}

					{#if dialogState.options?.checkbox}
						{@const cb = dialogState.options.checkbox}
						<div class="flex items-start gap-2.5">
							<Checkbox
								id="confirm-delete-checkbox"
								bind:checked={dialogState.checked}
								class="mt-0.5"
							/>
							<label
								for="confirm-delete-checkbox"
								class="grid cursor-pointer gap-0.5 text-left leading-snug"
							>
								<span class="text-sm font-medium">{cb.label}</span>
								{#if cb.description}
									<span class="text-xs text-muted-foreground">{cb.description}</span>
								{/if}
							</label>
						</div>
					{/if}

					{#if dialogState.options?.input}
						<Input
							bind:value={dialogState.inputText}
							placeholder={`Type "${dialogState.options.input.confirmationText}" to confirm`}
							class="font-mono text-xs"
							autofocus
						/>
					{/if}
				</div>
			</div>

			<AlertDialog.Footer>
				<AlertDialog.Cancel
					type="button"
					onclick={dialogState.cancel}
					disabled={dialogState.loading}
				>
					{dialogState.options?.cancel?.text ?? 'Cancel'}
				</AlertDialog.Cancel>
				<button
					type="submit"
					class={cn(buttonVariants({ variant: 'destructive' }))}
					disabled={!dialogState.canConfirm}
				>
					{#if dialogState.loading}
						<Loader2 class="size-3.5 animate-spin" />
					{/if}
					{dialogState.options?.confirm?.text ?? 'Delete'}
				</button>
			</AlertDialog.Footer>
		</form>
	</AlertDialog.Content>
</AlertDialog.Root>
