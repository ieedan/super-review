<script lang="ts">
	import { Check, ClipboardList, Copy, MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-svelte';
	import * as DropdownMenu from './ui/dropdown-menu';
	import HarnessLogo from './HarnessLogo.svelte';
	import { actions, app } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import type { LocalComment } from '@shared/types';

	// Newest first, but always sink resolved comments below the open ones so the
	// actionable feedback stays at the top.
	const sorted = $derived(
		[...app.localComments].sort((a, b) => {
			const ar = a.resolvedAt != null ? 1 : 0;
			const br = b.resolvedAt != null ? 1 : 0;
			if (ar !== br) return ar - br;
			return b.createdAt - a.createdAt;
		})
	);
	const unresolvedCount = $derived(app.localComments.filter((c) => c.resolvedAt == null).length);

	function lineLabel(c: LocalComment): string {
		return c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}-${c.endLine}`;
	}

	function fileName(path: string): string {
		const parts = path.split('/');
		return parts[parts.length - 1] || path;
	}
</script>

<div class="flex h-full flex-col border-l border-border bg-card/40">
	<header class="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
		<span class="text-sm font-semibold">Comments</span>
		{#if app.localComments.length > 0}
			<span class="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
				{app.localComments.length}
			</span>
		{/if}
		<div class="flex-1"></div>
		<button
			type="button"
			class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
			title="Copy all unresolved comments as a prompt"
			disabled={unresolvedCount === 0}
			onclick={() => actions.copyAllUnresolvedComments()}
		>
			<ClipboardList class="size-4" />
		</button>
		<button
			type="button"
			class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
			title="Close comments sidebar"
			onclick={() => actions.setCommentsSidebarOpen(false)}
		>
			<X class="size-4" />
		</button>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if sorted.length === 0}
			<div class="grid h-full place-items-center p-6 text-center">
				<div>
					<p class="text-sm text-muted-foreground">No comments yet</p>
					<p class="mt-1 text-xs text-muted-foreground">
						Click the <span class="font-medium">+</span> on a line in the diff to leave one.
					</p>
				</div>
			</div>
		{:else}
			<ul>
				{#each sorted as c (c.id)}
					{@const resolved = c.resolvedAt != null}
					<li class="border-b border-border">
						<div
							role="button"
							tabindex="0"
							class={[
								'group w-full cursor-pointer px-3 py-2.5 text-left hover:bg-accent/50',
								resolved && 'opacity-60'
							]}
							onclick={() => actions.revealComment(c.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									actions.revealComment(c.id);
								}
							}}
						>
							<div class="flex items-center gap-2">
								<span class="truncate text-xs font-medium">{c.author.name}</span>
								<span class="shrink-0 text-[11px] text-muted-foreground">
									{formatRelative(c.createdAt)}
								</span>
								{#if resolved}
									<span
										class="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
										style="background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success);"
									>
										<Check class="size-2.5" /> Resolved
									</span>
								{/if}
								<div class="flex-1"></div>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger
										class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground data-[state=open]:opacity-100"
										aria-label="Comment actions"
										onclick={(e: MouseEvent) => e.stopPropagation()}
									>
										<MoreHorizontal class="size-4" />
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										{#if resolved}
											<DropdownMenu.Item onSelect={() => actions.unresolveLocalComment(c.id)}>
												<RotateCcw class="size-3.5" /> Unresolve
											</DropdownMenu.Item>
										{:else}
											<DropdownMenu.Item onSelect={() => actions.resolveLocalComment(c.id)}>
												<Check class="size-3.5" /> Resolve
											</DropdownMenu.Item>
										{/if}
										<DropdownMenu.Item onSelect={() => actions.copyCommentPrompt(c.id)}>
											<Copy class="size-3.5" /> Copy as prompt
										</DropdownMenu.Item>
										<DropdownMenu.Separator />
										<DropdownMenu.Item
											variant="destructive"
											onSelect={() => actions.deleteLocalComment(c.id)}
										>
											<Trash2 class="size-3.5" /> Delete
										</DropdownMenu.Item>
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</div>
							<div class="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
								<span class="truncate font-mono">{fileName(c.path)}</span>
								<span class="shrink-0">·</span>
								<span class="shrink-0 font-mono">{lineLabel(c)}</span>
							</div>
							<p class="mt-1 line-clamp-3 text-[13px] whitespace-pre-wrap">{c.body}</p>
							{#if resolved && c.resolvedBy}
								<div class="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
									{#if c.resolvedBy.kind === 'agent' && c.resolvedBy.harness}
										<HarnessLogo harness={c.resolvedBy.harness} size={12} />
									{/if}
									<span>Resolved by {c.resolvedBy.name}</span>
									{#if c.resolvedSessionId}
										<button
											type="button"
											class="underline underline-offset-2 hover:opacity-80"
											style="color: var(--color-primary);"
											onclick={(e) => {
												e.stopPropagation();
												actions.openLinkedSession(c.resolvedSessionId!);
											}}
										>
											View session
										</button>
									{/if}
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
