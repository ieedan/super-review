import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';

// Cache of (font, maxWidth, prefix, suffix) → truncated prefix string. Hits
// on every steady-state render — the only time we miss is when the sidebar
// width or font changes.
const cache = new Map<string, string>();

const ELLIPSIS = '…';

function measure(text: string, font: string): number {
  return measureNaturalWidth(prepareWithSegments(text, font));
}

/**
 * Returns `prefix` (possibly truncated with a trailing ellipsis) such that
 * `result + suffix` fits within `maxWidth` pixels at the given CSS font.
 *
 * Used in the sidebar's list layout to pre-compute path truncation in JS,
 * avoiding the per-frame CSS reflow that `text-overflow: ellipsis` triggers
 * on sidebar resize when there are many rows. The full filename (passed as
 * `suffix`) is never truncated — only the directory prefix shrinks.
 */
export function truncatePathPrefix(
  prefix: string,
  suffix: string,
  maxWidth: number,
  font: string,
): string {
  if (!prefix || maxWidth <= 0) return prefix;
  const key = `${font}|${maxWidth}|${prefix}|${suffix}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  if (measure(prefix + suffix, font) <= maxWidth) {
    cache.set(key, prefix);
    return prefix;
  }

  // Binary-search the longest prefix slice that, with the ellipsis tacked on,
  // still leaves room for the full suffix at this maxWidth.
  let lo = 0;
  let hi = prefix.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const candidate = prefix.slice(0, mid) + ELLIPSIS + suffix;
    if (measure(candidate, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }

  const out = lo > 0 ? prefix.slice(0, lo) + ELLIPSIS : ELLIPSIS;
  cache.set(key, out);
  return out;
}
