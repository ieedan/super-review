<script lang="ts" module>
	// Vendored from shadcn-svelte-extras (FileDropZone), trimmed to what the
	// feedback dialog needs and adapted to this repo's `cn`/animation conventions.
	// Kept here rather than pulled via the registry CLI so the build has no network
	// dependency. A click-or-drag area that validates against `accept`, `maxFiles`
	// and `maxFileSize`, then hands the accepted File[] to `onUpload`.

	// Human-readable byte size, e.g. 1.5 MB. Exported so callers can label limits.
	export function displaySize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	export type FileRejectedReason = 'Maximum files' | 'File too large' | 'File type not allowed';
</script>

<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Upload from '@lucide/svelte/icons/upload';
	import { cn, type WithElementRef } from '$lib/utils.js';
	import { useAnimations } from '$lib/hooks/use-animations.svelte';

	const animations = useAnimations();

	type Props = WithElementRef<Omit<HTMLInputAttributes, 'onchange'>, HTMLInputElement> & {
		/** Comma-separated list of accepted types (e.g. "image/*,video/mp4"). */
		accept?: string;
		/** Max number of files allowed across the whole dialog. */
		maxFiles?: number;
		/** How many files are already attached, for the maxFiles check. */
		fileCount?: number;
		/** Per-file size cap in bytes. */
		maxFileSize?: number;
		disabled?: boolean;
		onUpload: (files: File[]) => Promise<void> | void;
		onFileRejected?: (args: { file: File; reason: FileRejectedReason }) => void;
	};

	let {
		ref = $bindable(null),
		accept,
		maxFiles,
		fileCount = 0,
		maxFileSize,
		disabled = false,
		class: className,
		onUpload,
		onFileRejected,
		children,
		...restProps
	}: Props = $props();

	let dragOver = $state(false);

	// Match a file against the `accept` list. Supports exact types ("video/mp4"),
	// wildcards ("image/*") and extensions (".png").
	function accepts(file: File): boolean {
		if (!accept) return true;
		const patterns = accept.split(',').map((p) => p.trim().toLowerCase());
		const name = file.name.toLowerCase();
		const type = file.type.toLowerCase();
		return patterns.some((p) => {
			if (p.startsWith('.')) return name.endsWith(p);
			if (p.endsWith('/*')) return type.startsWith(p.slice(0, -1));
			return type === p;
		});
	}

	function handle(files: FileList | null): void {
		if (!files || disabled) return;
		const accepted: File[] = [];
		let allowed = maxFiles === undefined ? Infinity : Math.max(0, maxFiles - fileCount);
		for (const file of Array.from(files)) {
			if (accepted.length >= allowed) {
				onFileRejected?.({ file, reason: 'Maximum files' });
				continue;
			}
			if (!accepts(file)) {
				onFileRejected?.({ file, reason: 'File type not allowed' });
				continue;
			}
			if (maxFileSize !== undefined && file.size > maxFileSize) {
				onFileRejected?.({ file, reason: 'File too large' });
				continue;
			}
			accepted.push(file);
		}
		if (accepted.length > 0) void onUpload(accepted);
	}

	function onInput(e: Event): void {
		const input = e.currentTarget as HTMLInputElement;
		handle(input.files);
		input.value = '';
	}

	function onDrop(e: DragEvent): void {
		e.preventDefault();
		dragOver = false;
		handle(e.dataTransfer?.files ?? null);
	}
</script>

<label
	data-slot="file-drop-zone"
	class={cn(
		'flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground outline-none hover:bg-accent focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
		dragOver && 'border-ring bg-accent',
		disabled && 'pointer-events-none opacity-50',
		animations.accentsEnabled && 'transition-colors',
		className
	)}
	ondragover={(e) => {
		e.preventDefault();
		if (!disabled) dragOver = true;
	}}
	ondragleave={() => (dragOver = false)}
	ondrop={onDrop}
>
	{#if children}
		{@render children()}
	{:else}
		<Upload class="size-5" />
		<div>
			<span class="font-medium text-foreground">Click to upload</span> or drag and drop
		</div>
		{#if maxFileSize !== undefined}
			<div class="text-xs">Up to {displaySize(maxFileSize)} each</div>
		{/if}
	{/if}
	<input
		bind:this={ref}
		type="file"
		class="hidden"
		multiple={maxFiles === undefined || maxFiles > 1}
		{accept}
		{disabled}
		onchange={onInput}
		{...restProps}
	/>
</label>
