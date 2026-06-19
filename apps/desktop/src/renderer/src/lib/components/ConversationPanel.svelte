<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import Eye from '@lucide/svelte/icons/eye';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import FileDiff from '@lucide/svelte/icons/file-diff';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import GitCommitHorizontal from '@lucide/svelte/icons/git-commit-horizontal';
	import GitMerge from '@lucide/svelte/icons/git-merge';
	import GitPullRequest from '@lucide/svelte/icons/git-pull-request';
	import GitPullRequestArrow from '@lucide/svelte/icons/git-pull-request-arrow';
	import GitPullRequestClosed from '@lucide/svelte/icons/git-pull-request-closed';
	import GitPullRequestDraft from '@lucide/svelte/icons/git-pull-request-draft';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import Lock from '@lucide/svelte/icons/lock';
	import LockOpen from '@lucide/svelte/icons/lock-open';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import MoreHorizontal from '@lucide/svelte/icons/more-horizontal';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Rocket from '@lucide/svelte/icons/rocket';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Tag from '@lucide/svelte/icons/tag';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import UserRoundMinus from '@lucide/svelte/icons/user-round-minus';
	import UserRoundPlus from '@lucide/svelte/icons/user-round-plus';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import Github from './icons/GithubIcon.svelte';
	import GithubSpinner from './GithubSpinner.svelte';
	import * as DropdownMenu from './ui/dropdown-menu';
	import { Input } from './ui/input';
	import { Textarea } from './ui/textarea';
	import MarkdownComposer from './MarkdownComposer.svelte';
	import MarkdownView from './MarkdownView.svelte';
	import { actions, app, effectiveGithubAccount, isReadOnlyView } from '$lib/store.svelte';
	import { formatRelative } from '$lib/utils';
	import { SvelteSet } from 'svelte/reactivity';
	import type {
		PRCheck,
		PRConversationItem,
		PRConversationReference,
		PRConversationReview,
		PRMergeMethod
	} from '@shared/types';

	// Commit keys whose extended description is expanded (the "…" toggle), like
	// GitHub's expandable commit message.
	const expandedCommits = new SvelteSet<string>();
	function toggleCommit(key: string): void {
		if (expandedCommits.has(key)) expandedCommits.delete(key);
		else expandedCommits.add(key);
	}

	// The PR whose conversation we're showing. In a `pr` review context that's
	// `activePR`; in the Branch tab with an open PR for the checked-out branch it's
	// `branchPR`. CommentsPanel only mounts this panel inside `isPRCommentContext()`,
	// so one of the two is always set.
	const pr = $derived(app.activePR ?? app.branchPR);

	// Whenever this panel is visible for a PR, make sure the feed is loaded. Covers
	// reopening the app straight onto the Conversation tab (the persisted tab) and
	// switching PRs while the tab is open; `ensurePRConversationLoaded` is a no-op
	// when the current PR's feed is already loaded or loading.
	$effect(() => {
		if (pr) actions.ensurePRConversationLoaded();
	});

	// Load the merge box (mergeability + checks) whenever the panel shows a PR.
	// Gated on PR number inside the store so this doesn't refetch on every
	// re-render; depending only on the number avoids a refresh loop when the
	// fetch folds fresh status back into the PR summary.
	$effect(() => {
		const n = pr?.number;
		if (n != null) actions.ensureMergeBox(n);
	});

	// The PR author can edit the description (and toggle its task checkboxes). We
	// gate on author identity rather than full write access — which we don't track
	// here — and let the API reject anything it shouldn't allow.
	const canEditDescription = $derived(!!pr && effectiveGithubAccount()?.login === pr.author);

	// Inline edit state. At most one comment (or the description) is edited at a
	// time; `editing` holds the target and the draft is kept locally so typing
	// doesn't churn the feed.
	let editing = $state<{ kind: 'comment'; id: number } | { kind: 'description' } | null>(null);
	let editDraft = $state('');
	let editSubmitting = $state(false);

	function startEditComment(id: number, body: string): void {
		editing = { kind: 'comment', id };
		editDraft = body;
	}
	function startEditDescription(body: string): void {
		editing = { kind: 'description' };
		editDraft = body;
	}
	function cancelEdit(): void {
		editing = null;
		editDraft = '';
	}
	async function saveEdit(): Promise<void> {
		if (!editing || editSubmitting) return;
		const body = editDraft.trim();
		if (!body) return;
		editSubmitting = true;
		const ok =
			editing.kind === 'comment'
				? await actions.editConversationComment(editing.id, body)
				: await actions.editPRDescription(body);
		editSubmitting = false;
		if (ok) cancelEdit();
	}
	function onEditKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void saveEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	// Inline style for a label chip, tinting GitHub's label color into a readable
	// pill (faint fill + accent border/text), matching how GitHub renders labels in
	// dark mode. `color` is the API's hex without a leading '#'.
	function labelChipStyle(color: string | undefined): string {
		if (!color) return '';
		const c = `#${color}`;
		return (
			`background: color-mix(in srgb, ${c} 18%, transparent);` +
			`border-color: color-mix(in srgb, ${c} 45%, transparent);` +
			`color: ${c};`
		);
	}

	// Composer state for posting a new top-level conversation comment.
	let draft = $state('');
	let submitting = $state(false);

	async function post(): Promise<void> {
		const body = draft.trim();
		if (!body || submitting) return;
		submitting = true;
		const ok = await actions.postConversationComment(body);
		submitting = false;
		if (ok) draft = '';
	}

	function onComposerKeydown(e: KeyboardEvent): void {
		// ⌘/Ctrl+Enter submits, matching the review-comment composer.
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void post();
		}
	}

	function viewOnGithub(url: string): void {
		if (url) void window.api.shell.openExternal(url);
	}

	// Status glyph + label + tint for the sticky header pill, matching how the PR
	// list renders it (green open, grey draft, red closed, purple merged). The
	// header fills the pill with the tint so it reads like GitHub's status badge.
	const prStatus = $derived.by(() => {
		if (!pr) return null;
		if (pr.merged) return { icon: GitMerge, color: 'var(--color-merged)', label: 'Merged' };
		if (pr.state === 'closed')
			return { icon: GitPullRequestClosed, color: 'var(--color-destructive)', label: 'Closed' };
		if (pr.draft)
			return {
				icon: GitPullRequestDraft,
				color: 'var(--color-muted-foreground)',
				label: 'Draft'
			};
		return { icon: GitPullRequest, color: 'var(--color-success)', label: 'Open' };
	});

	// ─── Merge box ────────────────────────────────────────────────────────────
	// Mergeability + checks for the panel's PR, guarded so a fetch left over from a
	// previously-shown PR never paints the current one.
	const mergeBox = $derived(
		app.mergeBox && pr && app.mergeBox.number === pr.number ? app.mergeBox : null
	);
	// Whether the PR is open and so still has a merge action.
	const isOpen = $derived(!!pr && pr.state === 'open' && !pr.merged);
	// Interactive actions (merge / ready) only make sense for the PR we're actually
	// working on, not a read-only browse of someone else's PR.
	const canAct = $derived(!isReadOnlyView());

	// CI checks come from the shared `prChecks` store (same fetch the header button
	// reads), keyed to this PR so a stale entry never paints the wrong one.
	const checks = $derived(
		app.prChecks && pr && app.prChecks.number === pr.number ? app.prChecks.summary : null
	);
	const checksState = $derived(checks && checks.state !== 'none' ? checks.state : null);
	const failing = $derived(checks?.checks.filter((c) => c.state === 'failure') ?? []);
	const running = $derived(checks?.checks.filter((c) => c.state === 'pending') ?? []);
	const passing = $derived(checks?.checks.filter((c) => c.state === 'success') ?? []);
	const deployments = $derived(checks?.deployments ?? []);
	let checksExpanded = $state(false);

	function plural(n: number, word: string): string {
		return `${n} ${word}${n === 1 ? '' : 's'}`;
	}

	// "owner:base" label for the merge event, matching how GitHub names the target
	// of a merge (e.g. "huntabyte:main"). Falls back to the bare base ref when the
	// base repo owner isn't known.
	const mergeBaseLabel = $derived.by(() => {
		if (!pr) return '';
		return pr.repoOwner ? `${pr.repoOwner}:${pr.baseRef}` : pr.baseRef;
	});
	// Checks rollup shown under the merge event ("6 checks passed"), reusing the
	// merge box's check fetch for the (merged) head commit. Empty until it loads.
	const mergedChecksText = $derived(
		passing.length > 0 ? `${plural(passing.length, 'check')} passed` : ''
	);

	// Title + subtitle for the checks row, mirroring GitHub's phrasing.
	const checksTitle = $derived.by(() => {
		switch (checksState) {
			case 'success':
				return 'All checks have passed';
			case 'failure':
				return 'Some checks were not successful';
			case 'pending':
				return "Some checks haven't completed yet";
			default:
				return '';
		}
	});
	const checksSubtitle = $derived.by(() => {
		const parts: string[] = [];
		if (failing.length) parts.push(plural(failing.length, 'failing check'));
		if (running.length) parts.push(`${running.length} in progress`);
		if (passing.length) parts.push(plural(passing.length, 'successful check'));
		return parts.join(', ');
	});

	function fmtDuration(ms: number | null): string {
		if (ms == null) return '';
		const s = Math.round(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		const rem = s % 60;
		return rem ? `${m}m ${rem}s` : `${m}m`;
	}
	function statusText(check: PRCheck): string {
		const d = fmtDuration(check.durationMs);
		switch (check.state) {
			case 'failure':
				return d ? `Failing after ${d}` : 'Failing';
			case 'success':
				return d ? `Successful in ${d}` : 'Successful';
			default:
				return 'In progress';
		}
	}

	// Conflict state derived from GitHub's mergeability: 'dirty' (or mergeable
	// false) means real conflicts; null/'unknown' means GitHub is still computing.
	const conflictState = $derived.by<'clean' | 'conflicts' | 'unknown'>(() => {
		if (!mergeBox) return 'unknown';
		if (mergeBox.mergeableState === 'dirty' || mergeBox.mergeable === false) return 'conflicts';
		if (mergeBox.mergeable === null || mergeBox.mergeableState === 'unknown') return 'unknown';
		return 'clean';
	});

	// Merge method picker. Squash is the common default; the choice is remembered
	// for the session.
	let mergeMethod = $state<PRMergeMethod>('squash');
	const METHOD_LABEL: Record<PRMergeMethod, string> = {
		squash: 'Squash and merge',
		merge: 'Create a merge commit',
		rebase: 'Rebase and merge'
	};
	const MERGE_METHODS: PRMergeMethod[] = ['squash', 'merge', 'rebase'];

	// While checks are still running, GitHub de-emphasizes the box: a borderless
	// blue ring spinner, a blue (not green) "no conflicts" check, and a neutral
	// (not green) merge button — so it doesn't look ready-to-merge prematurely.
	const checksPending = $derived(checksState === 'pending');

	const mergeBusy = $derived(app.mergeBoxBusy === 'merge');
	const readyBusy = $derived(app.mergeBoxBusy === 'ready');
	// A merge is hard to reverse, so the button arms a confirm step (GitHub does
	// the same) rather than firing on the first click. While armed, the squash/merge
	// methods expose the commit title + extended description for editing, prefilled
	// with GitHub's defaults.
	let confirmingMerge = $state(false);
	let commitTitle = $state('');
	let commitMessage = $state('');
	// Rebase replays the original commits, so there's no single merge-commit message
	// to edit (GitHub hides these fields for it too).
	const mergeCommitEditable = $derived(mergeMethod !== 'rebase');

	// Prefill the commit title with GitHub's default for the chosen method, then arm
	// the confirm step. Squash titles default to "<PR title> (#<number>)"; a merge
	// commit defaults to "Merge pull request #<number> from <head>". The extended
	// description starts empty — the user adds one only if they want it.
	function startConfirmMerge(): void {
		if (!pr) return;
		if (mergeMethod === 'merge') {
			const head = pr.headRepoOwner ? `${pr.headRepoOwner}/${pr.headRef}` : pr.headRef;
			commitTitle = `Merge pull request #${pr.number} from ${head}`;
		} else {
			commitTitle = `${pr.title} (#${pr.number})`;
		}
		commitMessage = '';
		confirmingMerge = true;
	}
	// Merging is blocked while it's a draft or has conflicts; GitHub greys the
	// button in those cases too.
	const mergeBlocked = $derived(!!pr?.draft || conflictState === 'conflicts');

	async function doReady(): Promise<void> {
		await actions.markPullRequestReady();
	}
	async function doMerge(): Promise<void> {
		const ok = await actions.mergePullRequest(
			mergeMethod,
			mergeCommitEditable ? commitTitle.trim() : undefined,
			mergeCommitEditable ? commitMessage : undefined
		);
		confirmingMerge = false;
		void ok;
	}

	// GitHub's author-association badge text ("Owner", "Member", …). Returns '' for
	// associations we don't badge (NONE, mannequin, etc.), so the badge is skipped.
	function associationLabel(a: string | undefined): string {
		switch (a) {
			case 'OWNER':
				return 'Owner';
			case 'MEMBER':
				return 'Member';
			case 'COLLABORATOR':
				return 'Collaborator';
			case 'CONTRIBUTOR':
				return 'Contributor';
			case 'FIRST_TIME_CONTRIBUTOR':
			case 'FIRST_TIMER':
				return 'First-time contributor';
			default:
				return '';
		}
	}

	// Human label + accent color for a review verdict.
	// Status badge (label + tint) for a cross-referenced issue/PR, matching the
	// header pill's color scheme.
	const REF_BADGE: Record<PRConversationReference['refState'], { label: string; color: string }> = {
		open: { label: 'Open', color: 'var(--color-success)' },
		closed: { label: 'Closed', color: 'var(--color-destructive)' },
		merged: { label: 'Merged', color: 'var(--color-merged)' },
		draft: { label: 'Draft', color: 'var(--color-muted-foreground)' }
	};

	const REVIEW_META: Record<PRConversationReview['state'], { label: string; color: string }> = {
		approved: { label: 'approved these changes', color: 'var(--color-success)' },
		changes_requested: { label: 'requested changes', color: 'var(--color-warning)' },
		commented: { label: 'reviewed', color: 'var(--color-muted-foreground, currentColor)' },
		dismissed: { label: 'review dismissed', color: 'var(--color-muted-foreground, currentColor)' }
	};

	// One-line label for a lightweight timeline event.
	function eventLabel(item: Extract<PRConversationItem, { kind: 'event' }>): string {
		switch (item.event) {
			case 'merged':
				return 'merged this pull request';
			case 'closed':
				return 'closed this pull request';
			case 'reopened':
				return 'reopened this pull request';
			case 'locked':
				return 'locked this conversation';
			case 'unlocked':
				return 'unlocked this conversation';
			case 'head_ref_force_pushed':
				return 'force-pushed the branch';
			case 'head_ref_deleted':
				return 'deleted the branch';
			case 'head_ref_restored':
				return 'restored the branch';
			case 'convert_to_draft':
				return 'marked this as a draft';
			case 'ready_for_review':
				return 'marked this ready for review';
			case 'labeled':
				return `added the ${item.detail ?? ''} label`;
			case 'unlabeled':
				return `removed the ${item.detail ?? ''} label`;
			case 'renamed':
				return `renamed this to “${item.detail ?? ''}”`;
			case 'review_requested':
				// Auto-requested Copilot reviews are re-attributed to Copilot upstream, so
				// `item.actor` is already "Copilot" — this reads "Copilot review requested …".
				return item.auto
					? 'review requested due to automatic review settings'
					: `requested a review from ${item.detail ?? 'someone'}`;
			case 'review_request_removed':
				return `removed the review request for ${item.detail ?? 'someone'}`;
			case 'assigned':
				return `assigned ${item.detail ?? 'someone'}`;
			case 'unassigned':
				return `unassigned ${item.detail ?? 'someone'}`;
			default:
				return item.event.replace(/_/g, ' ');
		}
	}

	// Icon for a timeline event, mirroring the glyph GitHub shows in its rail.
	// Anything unmapped falls back to the generic dot.
	const EVENT_ICONS: Record<string, typeof CircleDot> = {
		merged: GitMerge,
		closed: GitPullRequestClosed,
		reopened: GitPullRequestArrow,
		locked: Lock,
		unlocked: LockOpen,
		head_ref_force_pushed: GitCommitHorizontal,
		head_ref_deleted: Trash2,
		head_ref_restored: GitBranch,
		convert_to_draft: GitPullRequestDraft,
		ready_for_review: Eye,
		labeled: Tag,
		unlabeled: Tag,
		renamed: Pencil,
		review_requested: Eye,
		review_request_removed: Eye,
		assigned: UserRoundPlus,
		unassigned: UserRoundMinus
	};
	function eventIcon(event: string): typeof CircleDot {
		return EVENT_ICONS[event] ?? CircleDot;
	}

	// ─── Collapsing timeline churn ───────────────────────────────────────────────
	// Like GitHub, a long unbroken run of low-signal churn — commits plus lightweight
	// events (labels, assigns, force-pushes, review requests…) — is folded into a
	// single "Show N hidden items" row so the reader isn't made to scroll past dozens
	// of them. The discussion anchors (comments, reviews) and the terminal merge row
	// are always shown; they break runs apart. Commits are included because real PRs
	// interleave them with events, so an events-only rule almost never fires — the
	// noise the reader wants gone is the combined commit+event stream.
	const COLLAPSE_RUN_MIN = 5;
	const expandedRuns = new SvelteSet<string>();

	function isCollapsibleItem(item: PRConversationItem): boolean {
		if (item.kind === 'commit') return true;
		// `merged` is an event but rendered as its own rich row, so never fold it.
		return item.kind === 'event' && item.event !== 'merged';
	}

	// One rendered row: either a real conversation item or a folded run standing in
	// for `count` consecutive collapsible items.
	type FeedRow =
		| { type: 'item'; key: string; item: PRConversationItem }
		| { type: 'collapsed'; key: string; count: number };

	const feedRows = $derived.by<FeedRow[]>(() => {
		const items = app.prConversation;
		const rows: FeedRow[] = [];
		let i = 0;
		while (i < items.length) {
			if (!isCollapsibleItem(items[i])) {
				rows.push({ type: 'item', key: items[i].key, item: items[i] });
				i++;
				continue;
			}
			// Measure the maximal run of consecutive collapsible events.
			let j = i;
			while (j < items.length && isCollapsibleItem(items[j])) j++;
			const runKey = `run-${items[i].key}`;
			if (j - i >= COLLAPSE_RUN_MIN && !expandedRuns.has(runKey)) {
				rows.push({ type: 'collapsed', key: runKey, count: j - i });
			} else {
				for (let k = i; k < j; k++) rows.push({ type: 'item', key: items[k].key, item: items[k] });
			}
			i = j;
		}
		return rows;
	});
</script>

{#snippet assocBadge(association: string | undefined)}
	{@const label = associationLabel(association)}
	{#if label}
		<span
			class="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground"
		>
			{label}
		</span>
	{/if}
{/snippet}

{#snippet editComposer()}
	<MarkdownComposer
		bind:value={editDraft}
		placeholder="Leave a comment"
		disabled={editSubmitting}
		onkeydown={onEditKeydown}
		autofocus
	/>
	<div class="mt-2 flex items-center justify-end gap-2">
		<button
			type="button"
			class="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
			onclick={cancelEdit}
		>
			Cancel
		</button>
		<button
			type="button"
			class="rounded-md px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
			style="background: var(--color-primary);"
			disabled={!editDraft.trim() || editSubmitting}
			onclick={saveEdit}
		>
			{editSubmitting ? 'Saving…' : 'Save'}
		</button>
	</div>
{/snippet}

{#snippet checkRow(check: PRCheck)}
	<button
		type="button"
		class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
		disabled={!check.url}
		title={check.url ? `${check.name} — view run on GitHub` : check.name}
		onclick={() => check.url && viewOnGithub(check.url)}
	>
		{#if check.state === 'success'}
			<Check class="size-3.5 shrink-0 text-success" />
		{:else if check.state === 'failure'}
			<X class="size-3.5 shrink-0 text-destructive" />
		{:else}
			<GithubSpinner class="size-3.5 shrink-0 text-warning" />
		{/if}
		{#if check.avatarUrl}
			<img src={check.avatarUrl} alt="" class="size-3.5 shrink-0 rounded-full" />
		{/if}
		<span class="truncate">{check.name}</span>
		<span class="ml-auto shrink-0 whitespace-nowrap text-muted-foreground">{statusText(check)}</span
		>
	</button>
{/snippet}

{#snippet refStateIcon(item: PRConversationReference, cls: string)}
	{#if item.refState === 'merged'}
		<GitMerge class={cls} style="color: var(--color-merged);" />
	{:else if item.refState === 'draft'}
		<GitPullRequestDraft class="{cls} text-muted-foreground" />
	{:else if !item.isPullRequest}
		<CircleDot class={cls} style="color: {REF_BADGE[item.refState].color};" />
	{:else if item.refState === 'closed'}
		<GitPullRequestClosed class={cls} style="color: var(--color-destructive);" />
	{:else}
		<GitPullRequest class={cls} style="color: var(--color-success);" />
	{/if}
{/snippet}

<!-- GitHub-style merge box: checks rollup, conflicts, draft notice and the
     merge action, stacked at the foot of the conversation. -->
{#snippet mergeBoxView()}
	{#if pr && mergeBox}
		<div class="mx-auto w-full max-w-3xl px-3 pb-3">
			<div class="divide-y divide-border overflow-hidden rounded-lg border border-border">
				<!-- Checks rollup (collapsible). Hidden while confirming a merge so the
				     commit-message editor takes over the whole box, like GitHub. -->
				{#if checksState && checks && !confirmingMerge}
					<div>
						<button
							type="button"
							class="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40"
							onclick={() => (checksExpanded = !checksExpanded)}
						>
							<span
								class="grid size-7 shrink-0 place-items-center rounded-full text-white"
								style={checksState === 'success'
									? 'background: var(--color-success);'
									: checksState === 'failure'
										? 'background: var(--color-destructive);'
										: ''}
							>
								{#if checksState === 'success'}
									<Check class="size-4" />
								{:else if checksState === 'failure'}
									<X class="size-4" />
								{:else}
									<!-- GitHub shows a borderless blue ring spinner (not a filled blob)
									     while checks are still running. -->
									<span
										class="size-5 animate-spin rounded-full border-2 border-info/30 border-t-info"
									></span>
								{/if}
							</span>
							<div class="min-w-0 flex-1">
								<div class="text-[13px] font-semibold">{checksTitle}</div>
								{#if checksSubtitle}
									<div class="truncate text-[11px] text-muted-foreground">{checksSubtitle}</div>
								{/if}
							</div>
							<ChevronDown
								class={[
									'size-4 shrink-0 text-muted-foreground transition-transform',
									checksExpanded && 'rotate-180'
								]}
							/>
						</button>
						{#if checksExpanded}
							<div class="border-t border-border py-1">
								{#each failing as check (check.name)}
									{@render checkRow(check)}
								{/each}
								{#each running as check (check.name)}
									{@render checkRow(check)}
								{/each}
								{#each passing as check (check.name)}
									{@render checkRow(check)}
								{/each}
								{#if deployments.length > 0}
									<div
										class="mt-1 border-t border-border px-3 pt-2 pb-1 text-[11px] font-medium text-muted-foreground"
									>
										{plural(deployments.length, 'deployment')}
									</div>
									{#each deployments as d (d.environment)}
										<button
											type="button"
											class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/40"
											title={d.environment}
											onclick={() => viewOnGithub(d.url)}
										>
											{#if d.state === 'success'}
												<Check class="size-3.5 shrink-0 text-success" />
											{:else if d.state === 'failure'}
												<X class="size-3.5 shrink-0 text-destructive" />
											{:else if d.state === 'pending'}
												<GithubSpinner class="size-3.5 shrink-0 text-warning" />
											{/if}
											{#if d.avatarUrl}
												<img src={d.avatarUrl} alt="" class="size-3.5 shrink-0 rounded-full" />
											{:else}
												<Rocket class="size-3.5 shrink-0 text-muted-foreground" />
											{/if}
											<span class="truncate">{d.environment}</span>
											<span
												class="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground"
											>
												View deployment
												<ExternalLink class="size-3" />
											</span>
										</button>
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Conflicts / mergeability (open PRs only) -->
				{#if isOpen && !confirmingMerge}
					<div class="flex items-center gap-3 px-3 py-2.5">
						{#if conflictState === 'conflicts'}
							<span
								class="grid size-7 shrink-0 place-items-center rounded-full text-white"
								style="background: var(--color-warning);"
							>
								<TriangleAlert class="size-4" />
							</span>
							<div class="min-w-0">
								<div class="text-[13px] font-semibold">
									This branch has conflicts that must be resolved
								</div>
								<div class="text-[11px] text-muted-foreground">
									Resolve conflicts on the command line, then push.
								</div>
							</div>
						{:else if conflictState === 'unknown'}
							<span
								class="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
							>
								<GithubSpinner class="size-4" />
							</span>
							<div class="text-[13px] font-semibold">Checking for ability to merge…</div>
						{:else}
							<span
								class="grid size-7 shrink-0 place-items-center rounded-full text-white"
								style="background: {checksPending ? 'var(--color-info)' : 'var(--color-success)'};"
							>
								<Check class="size-4" />
							</span>
							<div class="min-w-0">
								<div class="text-[13px] font-semibold">No conflicts with base branch</div>
								<div class="text-[11px] text-muted-foreground">
									Merging can be performed automatically.
								</div>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Draft notice + Ready for review -->
				{#if isOpen && pr.draft && !confirmingMerge}
					<div class="flex items-center gap-3 px-3 py-2.5">
						<span
							class="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
						>
							<GitPullRequestDraft class="size-4" />
						</span>
						<div class="min-w-0 flex-1">
							<div class="text-[13px] font-semibold">
								This pull request is still a work in progress
							</div>
							<div class="text-[11px] text-muted-foreground">
								Draft pull requests cannot be merged.
							</div>
						</div>
						{#if canAct}
							<button
								type="button"
								class="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
								disabled={readyBusy}
								onclick={doReady}
							>
								{#if readyBusy}
									<Loader2 class="size-3.5 animate-spin" />
									Updating…
								{:else}
									Ready for review
								{/if}
							</button>
						{/if}
					</div>
				{/if}

				<!-- Merge action / final status -->
				{#if pr.merged}
					<div class="flex items-center gap-3 px-3 py-2.5">
						<span
							class="grid size-7 shrink-0 place-items-center rounded-full text-white"
							style="background: var(--color-merged);"
						>
							<GitMerge class="size-4" />
						</span>
						<div class="text-[13px] font-semibold">Pull request successfully merged and closed</div>
					</div>
				{:else if pr.state === 'closed'}
					<div class="flex items-center gap-3 px-3 py-2.5">
						<span
							class="grid size-7 shrink-0 place-items-center rounded-full text-white"
							style="background: var(--color-destructive);"
						>
							<GitPullRequestClosed class="size-4" />
						</span>
						<div class="text-[13px] font-semibold">Closed with unmerged commits</div>
					</div>
				{:else if canAct}
					<div class="flex flex-wrap items-center gap-2 px-3 py-2.5">
						{#if confirmingMerge}
							<div class="flex w-full flex-col gap-2">
								{#if mergeCommitEditable}
									<Input
										type="text"
										bind:value={commitTitle}
										placeholder="Commit message"
										disabled={mergeBusy}
										class="h-8 text-[13px] font-medium"
									/>
									<Textarea
										bind:value={commitMessage}
										placeholder="Extended description (optional)"
										rows={4}
										disabled={mergeBusy}
										class="resize-y px-2.5 py-1.5 text-xs"
									/>
								{/if}
								<div class="flex items-center gap-2">
									<button
										type="button"
										class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
										style="background: var(--color-success);"
										disabled={mergeBusy || (mergeCommitEditable && !commitTitle.trim())}
										onclick={doMerge}
									>
										{#if mergeBusy}
											<Loader2 class="size-3.5 animate-spin" />
											Merging…
										{:else}
											<GitMerge class="size-3.5" />
											Confirm {METHOD_LABEL[mergeMethod].toLowerCase()}
										{/if}
									</button>
									<button
										type="button"
										class="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
										disabled={mergeBusy}
										onclick={() => (confirmingMerge = false)}
									>
										Cancel
									</button>
								</div>
							</div>
						{:else}
							<div class="flex">
								<button
									type="button"
									class={[
										'inline-flex items-center gap-1.5 rounded-l-md px-3 py-1.5 text-xs font-medium disabled:opacity-50',
										checksPending
											? 'border border-border bg-secondary text-foreground hover:bg-accent'
											: 'text-white'
									]}
									style={checksPending ? '' : 'background: var(--color-success);'}
									disabled={mergeBlocked}
									title={mergeBlocked
										? pr.draft
											? 'Draft pull requests cannot be merged'
											: 'Resolve conflicts before merging'
										: METHOD_LABEL[mergeMethod]}
									onclick={startConfirmMerge}
								>
									<GitMerge class="size-3.5" />
									{METHOD_LABEL[mergeMethod]}
								</button>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger
										class={[
											'grid place-items-center rounded-r-md px-1.5 disabled:opacity-50',
											checksPending
												? 'border border-l-0 border-border bg-secondary text-foreground hover:bg-accent'
												: 'border-l border-white/25 text-white'
										]}
										style={checksPending ? '' : 'background: var(--color-success);'}
										disabled={mergeBlocked}
										aria-label="Choose merge method"
									>
										<ChevronDown class="size-4" />
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end" class="w-auto!">
										{#each MERGE_METHODS as m (m)}
											<DropdownMenu.Item onSelect={() => (mergeMethod = m)}>
												<Check class={['size-3.5', mergeMethod !== m && 'invisible']} />
												{METHOD_LABEL[m]}
											</DropdownMenu.Item>
										{/each}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</div>
							{#if mergeBlocked}
								<span class="text-[11px] text-muted-foreground">
									{pr.draft ? 'Mark ready for review to merge.' : 'Resolve conflicts to merge.'}
								</span>
							{/if}
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	{#if pr && prStatus}
		{@const Icon = prStatus.icon}
		<!-- Sticky status header: pinned above the scrolling feed so the PR's title,
		     status and branch line stay visible while reading the conversation. -->
		<div class="shrink-0 border-b border-border bg-background px-3 py-2">
			<div class="mx-auto w-full max-w-3xl">
				<h2 class="min-w-0 text-sm leading-snug font-semibold" title={pr.title}>
					<span class="line-clamp-2">
						{pr.title}
						<span class="font-normal text-muted-foreground">#{pr.number}</span>
					</span>
				</h2>
				<div class="mt-1.5 flex items-center gap-2 text-[11px]">
					<span
						class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium text-white"
						style="background: {prStatus.color};"
					>
						<Icon class="size-3" />
						{prStatus.label}
					</span>
					<span class="flex min-w-0 items-center gap-1 text-muted-foreground">
						<span class="truncate rounded bg-muted px-1 py-px font-mono">{pr.baseRef}</span>
						<span class="shrink-0">←</span>
						<span class="truncate rounded bg-muted px-1 py-px font-mono">{pr.headRef}</span>
					</span>
				</div>
			</div>
		</div>
	{/if}
	<div class="min-h-0 flex-1 overflow-y-auto">
		{#if !pr}
			<div class="grid h-full place-items-center p-6 text-center">
				<p class="text-sm text-muted-foreground">Open a pull request to see its conversation.</p>
			</div>
		{:else}
			<!-- A single timeline whose nodes (avatars / event icons) all sit on one
			     left rail. Each entry draws its own connector segment down to the next
			     node, so the line ends exactly at the last node regardless of how tall
			     the items above it are. `hasItems` decides whether the description's
			     connector is drawn. -->
			{@const hasItems = app.prConversation.length > 0}
			<div class="relative mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 py-3">
				<!-- PR description, the conversation's opening post. -->
				<div class="relative flex gap-3">
					{#if hasItems}
						<div
							class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
						></div>
					{/if}
					<img
						class="relative z-10 size-6 shrink-0 rounded-full"
						src={pr.authorAvatarUrl}
						alt={pr.author}
					/>
					<div
						class="comment-card group relative min-w-0 flex-1 rounded-lg border border-border bg-card"
					>
						<div
							class="comment-header flex min-h-6 items-center gap-1.5 rounded-t-[7px] border-b border-border px-3 py-1"
						>
							<span class="truncate text-xs font-medium">{pr.author}</span>
							{@render assocBadge(pr.authorAssociation)}
							<span class="shrink-0 text-[11px] text-muted-foreground">
								opened {formatRelative(pr.createdAt)}
							</span>
							<div class="flex-1"></div>
							{#if canEditDescription && editing?.kind !== 'description'}
								<button
									type="button"
									class="-mr-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
									title="Edit description"
									onclick={() => startEditDescription(pr.body)}
								>
									<Pencil class="size-3.5" />
								</button>
							{/if}
						</div>
						<div class="px-3 py-2">
							{#if editing?.kind === 'description'}
								{@render editComposer()}
							{:else if pr.body.trim()}
								<MarkdownView
									src={pr.body}
									class="text-[13px]"
									onToggleTask={canEditDescription
										? (s) => void actions.editPRDescription(s)
										: undefined}
								/>
							{:else}
								<p class="text-[13px] text-muted-foreground italic">No description provided.</p>
							{/if}
						</div>
					</div>
				</div>

				{#if app.loadingConversation && app.prConversation.length === 0}
					<div class="text-center text-xs text-muted-foreground">Loading conversation…</div>
				{/if}

				{#each feedRows as row, r (row.key)}
					{@const notLast = r < feedRows.length - 1}
					{#if row.type === 'collapsed'}
						<!-- Folded run of churn (commits + low-signal events), expandable in place.
						     The whole row (badge + label) is one button so clicking the icon
						     expands too, not just the text. -->
						<div class="relative flex">
							{#if notLast}
								<div
									class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
								></div>
							{/if}
							<button
								type="button"
								class="group/fold relative z-10 flex flex-1 items-center gap-3 text-left"
								onclick={() => expandedRuns.add(row.key)}
							>
								<div
									class="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-muted text-muted-foreground group-hover/fold:text-foreground"
								>
									<MoreHorizontal class="size-3.5" />
								</div>
								<span
									class="flex min-h-6 items-center text-[11px] text-muted-foreground group-hover/fold:text-foreground"
								>
									Show {row.count} hidden items
								</span>
							</button>
						</div>
					{:else}
						{@const item = row.item}
						{#if item.kind === 'comment'}
							<div class="group relative flex gap-3">
								{#if notLast}
									<div
										class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
									></div>
								{/if}
								<img
									class="relative z-10 size-6 shrink-0 rounded-full"
									src={item.authorAvatarUrl}
									alt={item.author}
								/>
								<div
									class="comment-card relative min-w-0 flex-1 rounded-lg border border-border bg-card"
								>
									<div
										class="comment-header flex min-h-6 items-center gap-1.5 rounded-t-[7px] border-b border-border px-3 py-1"
									>
										<span class="truncate text-xs font-medium">{item.author}</span>
										{@render assocBadge(item.authorAssociation)}
										<span class="shrink-0 text-[11px] text-muted-foreground">
											commented {formatRelative(item.createdAt)}
										</span>
										<div class="flex-1"></div>
										{#if item.url || item.canDelete}
											<DropdownMenu.Root>
												<DropdownMenu.Trigger
													class="-mr-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
													aria-label="More actions"
												>
													<MoreHorizontal class="size-4" />
												</DropdownMenu.Trigger>
												<DropdownMenu.Content align="end" class="w-auto!">
													{#if item.url}
														<DropdownMenu.Item onSelect={() => viewOnGithub(item.url)}>
															<Github class="size-3.5" /> View on GitHub
														</DropdownMenu.Item>
													{/if}
													{#if item.canDelete}
														{#if item.url}
															<DropdownMenu.Separator />
														{/if}
														<DropdownMenu.Item
															onSelect={() => startEditComment(item.id, item.body)}
														>
															<Pencil class="size-3.5" /> Edit
														</DropdownMenu.Item>
														<DropdownMenu.Item
															variant="destructive"
															onSelect={() => actions.deleteConversationComment(item.id)}
														>
															<Trash2 class="size-3.5" /> Delete
														</DropdownMenu.Item>
													{/if}
												</DropdownMenu.Content>
											</DropdownMenu.Root>
										{/if}
									</div>
									<div class="px-3 py-2">
										{#if editing?.kind === 'comment' && editing.id === item.id}
											{@render editComposer()}
										{:else}
											<MarkdownView
												src={item.body}
												class="text-[13px]"
												onToggleTask={item.canDelete
													? (s) => void actions.editConversationComment(item.id, s)
													: undefined}
											/>
										{/if}
									</div>
								</div>
							</div>
						{:else if item.kind === 'review'}
							{@const meta = REVIEW_META[item.state]}
							{@const hasBody = item.body.trim().length > 0}
							<!-- Verdict on its own timeline line (icon on the rail), like GitHub. -->
							<div class="relative flex gap-3">
								{#if notLast || hasBody}
									<div
										class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
									></div>
								{/if}
								<div
									class="relative z-10 grid size-6 shrink-0 place-items-center rounded-full"
									class:border={item.state !== 'approved'}
									class:border-border={item.state !== 'approved'}
									class:bg-muted={item.state !== 'approved'}
									style={item.state === 'approved'
										? 'background: var(--color-success); color: white;'
										: undefined}
								>
									{#if item.state === 'approved'}
										<Check class="size-3.5" />
									{:else if item.state === 'changes_requested'}
										<FileDiff class="size-3.5" style="color: {meta.color};" />
									{:else}
										<MessageSquare class="size-3.5 text-muted-foreground" />
									{/if}
								</div>
								<div
									class="flex min-h-6 min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground"
								>
									<span class="font-semibold text-foreground">{item.author}</span>
									<span class="shrink-0">{meta.label}</span>
									<div class="flex-1"></div>
									{#if item.url}
										<button
											type="button"
											class="shrink-0 hover:text-foreground"
											onclick={() => viewOnGithub(item.url)}
										>
											View reviewed changes
										</button>
									{/if}
									<span class="shrink-0">{formatRelative(item.createdAt)}</span>
								</div>
							</div>
							<!-- The review's summary body as a separate, state-tinted comment card. -->
							{#if hasBody}
								<div class="relative flex gap-3">
									{#if notLast}
										<div
											class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
										></div>
									{/if}
									<img
										class="relative z-10 size-6 shrink-0 rounded-full"
										src={item.authorAvatarUrl}
										alt={item.author}
									/>
									<div
										class="comment-card relative min-w-0 flex-1 rounded-lg border border-border bg-card"
										style="--bubble: color-mix(in srgb, {meta.color} 16%, var(--color-card));"
									>
										<div
											class="comment-header flex min-h-6 items-center gap-1.5 rounded-t-[7px] border-b border-border px-3 py-1"
										>
											<span class="truncate text-xs font-medium">{item.author}</span>
											{@render assocBadge(item.authorAssociation)}
										</div>
										<div class="px-3 py-2">
											<MarkdownView src={item.body} class="text-[13px]" />
										</div>
									</div>
								</div>
							{/if}
						{:else if item.kind === 'commit'}
							<div class="relative flex gap-3">
								{#if notLast}
									<div
										class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
									></div>
								{/if}
								<div
									class="relative z-10 grid size-6 shrink-0 place-items-center rounded-full border border-border bg-muted text-muted-foreground"
								>
									<GitCommitHorizontal class="size-3.5" />
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex min-h-6 items-center gap-2 text-xs">
										{#if item.authorAvatarUrl}
											<img
												class="size-4 shrink-0 rounded-full"
												src={item.authorAvatarUrl}
												alt={item.author}
											/>
										{/if}
										<button
											type="button"
											class="min-w-0 truncate text-left hover:text-foreground disabled:hover:text-current"
											disabled={!item.url}
											onclick={() => item.url && viewOnGithub(item.url)}
											title={item.url ? `${item.author} · view commit on GitHub` : item.author}
										>
											{item.message}
										</button>
										{#if item.body}
											<button
												type="button"
												class={[
													'grid h-4 shrink-0 place-items-center rounded border border-border px-1 text-muted-foreground hover:bg-accent hover:text-foreground',
													expandedCommits.has(item.key) && 'bg-accent text-foreground'
												]}
												title="Toggle commit description"
												aria-expanded={expandedCommits.has(item.key)}
												onclick={() => toggleCommit(item.key)}
											>
												<MoreHorizontal class="size-3" />
											</button>
										{/if}
										<div class="flex-1"></div>
										{#if item.verified}
											<span
												class="inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-px text-[10px] font-medium"
												style="border-color: color-mix(in srgb, var(--color-success) 50%, transparent); color: var(--color-success);"
											>
												<ShieldCheck class="size-2.5" /> Verified
											</span>
										{/if}
										<button
											type="button"
											class="shrink-0 font-mono text-[11px] text-muted-foreground hover:text-foreground disabled:hover:text-current"
											disabled={!item.url}
											onclick={() => item.url && viewOnGithub(item.url)}
										>
											{item.shortSha}
										</button>
									</div>
									{#if item.body && expandedCommits.has(item.key)}
										<pre
											class="mt-1 max-h-60 overflow-auto rounded border border-border bg-card px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{item.body}</pre>
									{/if}
								</div>
							</div>
						{:else if item.kind === 'reference'}
							{@const badge = REF_BADGE[item.refState]}
							<!-- Cross-reference: another issue/PR mentioned this one. -->
							<div class="relative flex gap-3">
								{#if notLast}
									<div
										class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
									></div>
								{/if}
								<div
									class="relative z-10 grid size-6 shrink-0 place-items-center rounded-full bg-card text-muted-foreground"
								>
									<ExternalLink class="size-3.5" />
								</div>
								<div class="flex min-w-0 flex-1 flex-col gap-1">
									<div
										class="flex min-h-6 min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
									>
										<span class="font-semibold text-foreground">{item.actor}</span>
										<span class="truncate"
											>mentioned this {item.isPullRequest ? 'pull request' : 'issue'}</span
										>
										<div class="flex-1"></div>
										<span class="shrink-0">{formatRelative(item.createdAt)}</span>
									</div>
									<!-- Plain row (no card), matching GitHub: state icon, linked title,
										     and a subtle state pill. -->
									<div class="flex min-w-0 items-center gap-1.5">
										{@render refStateIcon(item, 'size-4 shrink-0')}
										<button
											type="button"
											class="min-w-0 truncate text-left text-[13px] font-medium text-foreground hover:underline"
											onclick={() => viewOnGithub(item.refUrl)}
										>
											{item.refTitle}
											<span class="font-normal text-muted-foreground">#{item.refNumber}</span>
										</button>
										<div class="flex-1"></div>
										<span
											class="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
										>
											{@render refStateIcon(item, 'size-3')}
											{badge.label}
										</span>
									</div>
								</div>
							</div>
						{:else if item.event === 'merged'}
							<!-- Merge: one rich row (commit + base + checks at merge), replacing
						     GitHub's redundant merged + closed pair. -->
							<div class="relative flex gap-3">
								{#if notLast}
									<div
										class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
									></div>
								{/if}
								<div
									class="relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-white"
									style="background: var(--color-merged);"
								>
									<GitMerge class="size-3.5" />
								</div>
								<div class="flex min-w-0 flex-1 flex-col">
									<div
										class="flex min-h-6 min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"
									>
										<!-- Rendered as a single inline run so the words sit with natural
									     spacing rather than flex-gapped apart. -->
										<div class="min-w-0 flex-1 truncate">
											<span class="font-semibold text-foreground">{item.actor}</span>
											{#if item.commitSha}
												merged commit
												<button
													type="button"
													class="font-mono text-foreground hover:underline disabled:no-underline"
													disabled={!item.commitUrl}
													onclick={() => item.commitUrl && viewOnGithub(item.commitUrl)}
													>{item.commitSha}</button
												>
												into
											{:else}
												merged into
											{/if}
											<span class="font-mono text-foreground">{mergeBaseLabel}</span>
										</div>
										<span class="shrink-0">{formatRelative(item.createdAt)}</span>
									</div>
									{#if mergedChecksText}
										<div class="-mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
											<Check class="size-3 shrink-0 text-success" />
											{mergedChecksText}
										</div>
									{/if}
								</div>
							</div>
						{:else}
							{@const EventIcon = eventIcon(item.event)}
							<!-- Lightweight timeline event. -->
							<div class="relative flex gap-3">
								{#if notLast}
									<div
										class="pointer-events-none absolute top-3 -bottom-6 left-3 w-px -translate-x-1/2 bg-border"
									></div>
								{/if}
								<div
									class="relative z-10 grid size-6 shrink-0 place-items-center rounded-full border border-border bg-muted text-muted-foreground"
								>
									<EventIcon class="size-3.5" />
								</div>
								{#if item.event === 'renamed' && item.renamedFrom}
									<!-- Title change: GitHub shows the old title struck through above the
									     new one, so the row reads as a before/after. -->
									<div
										class="flex min-h-6 min-w-0 flex-1 flex-col gap-0.5 text-[11px] text-muted-foreground"
									>
										<div class="flex items-center gap-1.5">
											<span class="font-medium text-foreground/80">{item.actor}</span>
											<span class="shrink-0">changed the title</span>
											<div class="flex-1"></div>
											<span class="shrink-0">{formatRelative(item.createdAt)}</span>
										</div>
										<div class="min-w-0 leading-snug">
											<div class="truncate line-through">{item.renamedFrom}</div>
											<div class="truncate text-foreground/80">{item.detail}</div>
										</div>
									</div>
								{:else}
									<div
										class="flex min-h-6 min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground"
									>
										<span class="font-medium text-foreground/80">{item.actor}</span>
										{#if item.event === 'labeled' || item.event === 'unlabeled'}
											<span class="shrink-0"
												>{item.event === 'labeled' ? 'added the' : 'removed the'}</span
											>
											<span
												class="inline-flex max-w-40 shrink-0 items-center truncate rounded-full border px-2 py-px text-[10px] font-medium"
												style={labelChipStyle(item.labelColor)}
											>
												{item.detail}
											</span>
											<span class="shrink-0">label</span>
										{:else}
											<span class="truncate">{eventLabel(item)}</span>
										{/if}
										<div class="flex-1"></div>
										<span class="shrink-0">{formatRelative(item.createdAt)}</span>
									</div>
								{/if}
							</div>
						{/if}
					{/if}
				{/each}
			</div>

			{#if mergeBox}
				{@render mergeBoxView()}
			{/if}
		{/if}
	</div>

	{#if pr}
		<!-- Composer pinned to the bottom for posting a new conversation comment. -->
		<div class="shrink-0 border-t border-border p-2">
			<div class="mx-auto w-full max-w-3xl">
				<MarkdownComposer
					bind:value={draft}
					placeholder="Leave a comment"
					disabled={submitting}
					onkeydown={onComposerKeydown}
				/>
				<div class="mt-2 flex items-center justify-end">
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
						style="background: var(--color-primary);"
						disabled={!draft.trim() || submitting}
						onclick={post}
					>
						{submitting ? 'Posting…' : 'Comment'}
						<span class="ml-1 opacity-70">⌘⏎</span>
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* The comment box's header bar is tinted a step away from the card body so the
	   two read as distinct, GitHub-style. The same color fills the speech-bubble
	   tail, which sits on the header. */
	.comment-card {
		--bubble: color-mix(in srgb, var(--color-muted) 55%, var(--color-card));
	}
	.comment-header {
		background: var(--bubble);
	}

	/* GitHub-style speech-bubble tail: a triangle on the comment box's left edge
	   pointing back at the author avatar in the rail gutter. The ::before is a
	   border-colored triangle; the ::after is a bubble-colored fill 1px smaller and
	   re-centered (margin-top) so the border shows as a 1px outline on BOTH
	   diagonals, then nudged 1px right (margin-right) to overlap the box's left
	   border so the tail merges into the header. Level with the avatar (~12px from
	   the card top). */
	.comment-card::before,
	.comment-card::after {
		content: '';
		position: absolute;
		top: 4px;
		right: 100%;
		width: 0;
		height: 0;
		border: 8px solid transparent;
		border-right-color: var(--color-border);
	}
	.comment-card::after {
		border-width: 7px;
		border-right-color: var(--bubble);
		margin-top: 1px;
		margin-right: -1px;
	}
</style>
