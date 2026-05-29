import type { Component, Snippet } from 'svelte';
import VirtualListRaw from 'svelte-tiny-virtual-list';

// svelte-tiny-virtual-list ships Svelte 4 slot typings, which svelte-check
// does not bridge to the snippet-prop form used in Svelte 5. Re-export it with
// the props we actually use so the `item` snippet type-checks.
export type VirtualListItem = { index: number; style: string };

export const VirtualList = VirtualListRaw as unknown as Component<{
  width?: string;
  height: number;
  itemCount: number;
  // svelte-tiny-virtual-list accepts a fixed size, a per-index array, or a
  // function — the latter lets us mix compact group headers with taller rows.
  itemSize: number | number[] | ((index: number) => number);
  overscanCount?: number;
  item: Snippet<[VirtualListItem]>;
}>;
