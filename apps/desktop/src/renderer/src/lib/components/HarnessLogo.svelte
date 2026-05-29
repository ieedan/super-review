<script lang="ts">
  import { Bot } from "lucide-svelte";
  import type { HarnessKind } from "@shared/types";
  import { app } from "$lib/store.svelte";
  import { resolveHarnessLogo } from "$lib/harness-logos";

  let {
    harness,
    size = 20,
    class: className = "",
  }: { harness: HarnessKind; size?: number; class?: string } = $props();

  let url = $state<string | null>(null);
  let failed = $state(false);

  // Resolve (and cache) the logo URL whenever the harness or theme changes.
  $effect(() => {
    const h = harness;
    const theme = app.theme;
    url = null;
    failed = false;
    void resolveHarnessLogo(h, theme).then((resolved) => {
      if (h === harness) url = resolved;
    });
  });
</script>

{#if url && !failed}
  <img
    src={url}
    alt=""
    width={size}
    height={size}
    class={className}
    onerror={() => (failed = true)}
  />
{:else}
  <Bot style={`width:${size}px;height:${size}px`} class={className} />
{/if}
