<script lang="ts">
  import { MessageSquareText } from "lucide-svelte";
  import { app } from "$lib/store.svelte";
  import { renderMarkdown } from "$lib/markdown";
  import "$lib/markdown.css";
  import type { SessionCallout } from "@shared/types";

  // Inline agent callout, mounted by DiffFileSection at the start line of a
  // callout's range. Styled distinctly from review comments — this is the
  // agent narrating the code, not a review thread.
  let { callout }: { callout: SessionCallout } = $props();

  const rangeLabel = $derived(
    callout.startLine === callout.endLine
      ? `Line ${callout.startLine}`
      : `Lines ${callout.startLine}–${callout.endLine}`,
  );

  let html = $state("");
  $effect(() => {
    const src = callout.body;
    const theme = app.theme;
    if (!src.trim()) {
      html = "";
      return;
    }
    let cancelled = false;
    void renderMarkdown(src, theme)
      .then((h) => {
        if (!cancelled) html = h;
      })
      .catch(() => {
        if (!cancelled) html = "";
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<div
  class="my-1 ml-2 mr-3 rounded-md border border-primary/30 border-l-2 border-l-primary bg-primary/5 px-3 py-2"
>
  <div
    class="flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-primary"
  >
    <MessageSquareText class="size-3.5" />
    <span>{rangeLabel}</span>
    <span class="text-muted-foreground"
      >· {callout.side === "old" ? "original" : "new"}</span
    >
  </div>
  {#if html}
    <div class="markdown-body mt-1.5 text-sm">{@html html}</div>
  {/if}
</div>
