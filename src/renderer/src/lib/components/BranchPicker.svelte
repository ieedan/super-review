<script lang="ts">
  import { Command as CommandPrimitive } from "bits-ui";
  import {
    ChevronDown,
    GitBranch,
    GitFork,
    GitMerge,
    GitPullRequest,
    GitPullRequestClosed,
    GitPullRequestDraft,
    Loader2,
    Plus,
    Search,
  } from "lucide-svelte";
  import { VirtualList } from "$lib/virtual-list";
  import { Button, buttonVariants } from "./ui/button";
  import * as Popover from "./ui/popover";
  import * as Command from "./ui/command";
  import * as Tabs from "./ui/tabs";
  import { actions, app } from "$lib/store.svelte";
  import { cn, formatRelative } from "$lib/utils";
  import type { BranchInfo, PRSource, PRSummary } from "@shared/types";

  const ITEM_SIZE = 28;
  const PR_ITEM_SIZE = 48;
  const MAX_LIST_HEIGHT = 320;

  let open = $state(false);
  let filter = $state("");
  let tab = $state<"branches" | "prs">("branches");
  // Track whether we've kicked off a PR fetch for the current popover session
  // so switching to the tab loads once rather than on every render.
  let prsRequested = $state(false);

  // Reset PR fetch tracking when the active repo changes — the next visit to
  // the Pull Requests tab should refetch for the new repo.
  let lastRepoId = $state<string | null>(null);
  $effect(() => {
    const id = app.activeRepo?.id ?? null;
    if (id !== lastRepoId) {
      lastRepoId = id;
      prsRequested = false;
    }
  });

  function reset(): void {
    filter = "";
    tab = "branches";
    prsRequested = false;
  }

  function selectTab(value: string): void {
    tab = value === "prs" ? "prs" : "branches";
    // The two lists filter different things; carrying the query across is
    // confusing, so start each tab fresh.
    filter = "";
    if (tab === "prs" && !prsRequested) {
      prsRequested = true;
      void actions.loadPRs();
    }
  }

  async function checkout(name: string): Promise<void> {
    open = false;
    await actions.checkoutBranch(name);
  }

  async function openPR(pr: PRSummary): Promise<void> {
    open = false;
    await actions.checkoutPR(pr);
  }

  function openCreate(): void {
    open = false;
    actions.openCreateBranchDialog();
  }

  type Row =
    | { kind: "heading"; label: string }
    | { kind: "branch"; branch: BranchInfo };

  // Flatten the default + recent sections (and their headings) into a single
  // list of rows. Everything lives inside one virtualized scroll container so
  // the whole popover scrolls together rather than the recent list scrolling
  // on its own. Filtering is applied here (rather than via Command's built-in
  // matcher) because the rows are virtualized and not all present in the DOM.
  const rows = $derived.by(() => {
    const defaultName = app.activeRepo?.defaultBranch;
    const needle = filter.trim().toLowerCase();
    const matches = (b: BranchInfo): boolean =>
      needle === "" || b.name.toLowerCase().includes(needle);
    let defaultBranch: BranchInfo | null = null;
    const recent: BranchInfo[] = [];
    for (const b of app.branches) {
      if (defaultName && b.name === defaultName && !defaultBranch) {
        defaultBranch = matches(b) ? b : null;
      } else if (matches(b)) {
        recent.push(b);
      }
    }
    const result: Row[] = [];
    if (defaultBranch) {
      result.push({ kind: "heading", label: "Default Branch" });
      result.push({ kind: "branch", branch: defaultBranch });
    }
    if (recent.length > 0) {
      result.push({ kind: "heading", label: "Recent Branches" });
      for (const b of recent) result.push({ kind: "branch", branch: b });
    }
    return result;
  });

  const listHeight = $derived(
    Math.min(MAX_LIST_HEIGHT, Math.max(ITEM_SIZE, rows.length * ITEM_SIZE)),
  );

  // PR rows, filtered by title / number / author / branch. A trailing
  // `loadMore` sentinel row is appended whenever more pages remain — once it
  // scrolls into the virtualized window it triggers the next fetch.
  type PRRow = { kind: "pr"; pr: PRSummary } | { kind: "loadMore" };
  const prRows = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    const matches = (p: PRSummary): boolean =>
      needle === "" ||
      p.title.toLowerCase().includes(needle) ||
      String(p.number).includes(needle) ||
      p.author.toLowerCase().includes(needle) ||
      p.headRef.toLowerCase().includes(needle);
    const result: PRRow[] = app.prs
      .filter(matches)
      .map((pr) => ({ kind: "pr", pr }) as PRRow);
    // Only offer "load more" for the unfiltered list — paging makes no sense
    // while a local filter is narrowing what's already fetched.
    if (app.prsHasMore && needle === "") result.push({ kind: "loadMore" });
    return result;
  });

  const prListHeight = $derived(
    Math.min(
      MAX_LIST_HEIGHT,
      Math.max(PR_ITEM_SIZE, prRows.length * PR_ITEM_SIZE),
    ),
  );

  // The status glyph + tint for a PR: green open, grey draft, red closed,
  // purple merged.
  function prStatus(pr: PRSummary): {
    icon: typeof GitMerge;
    class: string;
    label: string;
  } {
    if (pr.merged)
      return { icon: GitMerge, class: "text-merged", label: "Merged" };
    if (pr.state === "closed")
      return {
        icon: GitPullRequestClosed,
        class: "text-destructive",
        label: "Closed",
      };
    if (pr.draft)
      return {
        icon: GitPullRequestDraft,
        class: "text-muted-foreground",
        label: "Draft",
      };
    return { icon: GitPullRequest, class: "text-success", label: "Open" };
  }

  // Svelte action: fire a "load more" the moment the sentinel row mounts (i.e.
  // scrolls into the virtualized window). The store guards against overlapping
  // and redundant loads, so remounts on scroll are safe.
  function loadMoreOnMount(_node: HTMLElement) {
    void actions.loadMorePRs();
  }

  // Re-derive on `nowTick` so the relative timestamps stay live while the
  // popover is open.
  function relativeFor(b: BranchInfo): string | null {
    void app.nowTick;
    if (!b.lastCommitAt) return null;
    return formatRelative(new Date(b.lastCommitAt).toISOString());
  }

  function prRelative(pr: PRSummary): string {
    void app.nowTick;
    return formatRelative(pr.updatedAt);
  }

  // A fork exposes its parent repo's PRs too — show the source switcher then.
  const hasUpstream = $derived(
    !!(app.activeRepo?.upstreamOwner && app.activeRepo?.upstreamRepo),
  );

  function sourceLabel(source: PRSource): string {
    const r = app.activeRepo;
    if (!r) return "";
    return source === "upstream"
      ? `${r.upstreamOwner}/${r.upstreamRepo}`
      : `${r.githubOwner}/${r.githubRepo}`;
  }
</script>

<Popover.Root
  bind:open
  onOpenChange={(v) => {
    if (!v) reset();
  }}
>
  <Popover.Trigger
    disabled={!app.activeRepo}
    class={cn(buttonVariants({ variant: "ghost", size: "sm" }), "font-normal")}
  >
    <GitBranch class="size-3.5 text-muted-foreground" />
    <span>
      {app.currentBranch ?? "no branch"}
    </span>
    <ChevronDown class="size-3.5 text-muted-foreground" />
  </Popover.Trigger>
  <Popover.Content align="start" class="w-[26rem] p-0">
    <Tabs.Root value={tab} onValueChange={selectTab}>
      <!-- Underline tabs across the top of the picker. -->
      <Tabs.List
        variant="line"
        class="h-9 w-full justify-start gap-3 rounded-none border-b border-border bg-transparent px-3 py-0"
      >
        <Tabs.Trigger
          value="branches"
          class="h-full flex-none px-0 py-0 text-sm"
        >
          Branches
        </Tabs.Trigger>
        <Tabs.Trigger value="prs" class="h-full flex-none px-0 py-0 text-sm">
          Pull Requests
        </Tabs.Trigger>
      </Tabs.List>

      <Command.Root shouldFilter={false}>
        <!-- Sticky header: filter input on the left; "New branch" appears on
             the Branches tab only. Both stay visible while the list scrolls. -->
        <div class="flex items-center gap-2 border-b border-border p-2">
          <div
            class="flex h-8 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2"
          >
            <Search class="size-3.5 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              bind:value={filter}
              placeholder={tab === "prs" ? "Filter pull requests…" : "Filter…"}
              class="flex h-full w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
            />
          </div>
          {#if tab === "branches"}
            <Button size="sm" class="h-8 shrink-0 gap-1.5" onclick={openCreate}>
              <Plus class="size-3.5" />
              New branch
            </Button>
          {/if}
        </div>

        <Tabs.Content value="branches" class="mt-0">
          <Command.List class="max-h-[320px] overflow-hidden">
            {#if app.branches.length === 0}
              <div class="px-3 py-6 text-center text-xs text-muted-foreground">
                No branches
              </div>
            {:else if rows.length === 0}
              <div class="px-3 py-6 text-center text-xs text-muted-foreground">
                No matches
              </div>
            {:else}
              <Command.Group class="p-1">
                <VirtualList
                  width="100%"
                  itemSize={ITEM_SIZE}
                  itemCount={rows.length}
                  height={listHeight}
                >
                  {#snippet item({ index, style })}
                    {@const row = rows[index]}
                    <div {style}>
                      {#if row.kind === "heading"}
                        <div
                          class="px-2 py-1.5 text-xs font-medium text-muted-foreground"
                        >
                          {row.label}
                        </div>
                      {:else}
                        {@const b = row.branch}
                        <Command.Item
                          value={b.name}
                          onSelect={() => checkout(b.name)}
                          class={cn(
                            "flex items-center gap-2",
                            b.current && "bg-accent/60",
                          )}
                        >
                          <GitBranch
                            class={cn(
                              "size-3.5",
                              b.current
                                ? "text-success"
                                : "text-muted-foreground",
                            )}
                          />
                          <span
                            class={cn(
                              "min-w-0 flex-1 truncate font-mono text-xs",
                              b.current && "font-semibold",
                            )}
                          >
                            {b.name}
                          </span>
                          {#if relativeFor(b)}
                            <span
                              class="shrink-0 text-[10px] text-muted-foreground"
                            >
                              {relativeFor(b)}
                            </span>
                          {/if}
                        </Command.Item>
                      {/if}
                    </div>
                  {/snippet}
                </VirtualList>
              </Command.Group>
            {/if}
          </Command.List>
        </Tabs.Content>

        <Tabs.Content value="prs" class="mt-0">
          {#if hasUpstream}
            <!-- Fork repos can browse their own PRs or their upstream's. -->
            <div
              class="flex items-center gap-2 border-b border-border px-2 py-1.5"
            >
              <GitFork class="size-3.5 shrink-0 text-muted-foreground" />
              <span
                class="min-w-0 flex-1 truncate font-mono text-xs"
                title={sourceLabel(app.prsSource)}
              >
                {sourceLabel(app.prsSource)}
              </span>
              <div
                class="flex shrink-0 items-center gap-0.5 rounded-md border border-input p-0.5"
              >
                {#each [{ value: "upstream", label: "Upstream" }, { value: "fork", label: "Fork" }] as opt (opt.value)}
                  <button
                    type="button"
                    onclick={() => actions.setPRSource(opt.value as PRSource)}
                    title={sourceLabel(opt.value as PRSource)}
                    class={cn(
                      "rounded px-1.5 py-0.5 text-[11px] font-medium",
                      app.prsSource === opt.value
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                {/each}
              </div>
            </div>
          {/if}
          <Command.List class="max-h-[320px] overflow-hidden">
            {#if app.loading.prs}
              <div
                class="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground"
              >
                <Loader2 class="size-3.5 animate-spin" />
                Loading pull requests…
              </div>
            {:else if app.prs.length === 0}
              <div class="px-3 py-6 text-center text-xs text-muted-foreground">
                No pull requests
              </div>
            {:else if prRows.length === 0}
              <div class="px-3 py-6 text-center text-xs text-muted-foreground">
                No matches
              </div>
            {:else}
              <Command.Group class="p-1">
                <VirtualList
                  width="100%"
                  itemSize={PR_ITEM_SIZE}
                  itemCount={prRows.length}
                  height={prListHeight}
                >
                  {#snippet item({ index, style })}
                    {@const row = prRows[index]}
                    <div {style}>
                      {#if row.kind === "loadMore"}
                        <div
                          use:loadMoreOnMount
                          class="flex items-center justify-center gap-2 py-3 text-[10px] text-muted-foreground"
                        >
                          <Loader2 class="size-3 animate-spin" />
                          Loading more…
                        </div>
                      {:else}
                        {@const pr = row.pr}
                        {@const status = prStatus(pr)}
                        {@const Icon = status.icon}
                        <button
                          type="button"
                          onclick={() => openPR(pr)}
                          title={pr.title}
                          class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
                        >
                          <Icon
                            class={cn("size-4 shrink-0", status.class)}
                            aria-label={status.label}
                          />
                          <div class="flex min-w-0 flex-1 flex-col">
                            <span class="truncate text-xs font-medium">
                              {pr.title}
                            </span>
                            <span
                              class="truncate text-[10px] text-muted-foreground"
                            >
                              #{pr.number} · {pr.author} · {prRelative(pr)}
                            </span>
                          </div>
                        </button>
                      {/if}
                    </div>
                  {/snippet}
                </VirtualList>
              </Command.Group>
            {/if}
          </Command.List>
        </Tabs.Content>
      </Command.Root>
    </Tabs.Root>
  </Popover.Content>
</Popover.Root>
