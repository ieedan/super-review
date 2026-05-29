import type { HarnessKind } from "@shared/types";

// Display label + the term used to look the logo up on svgl (https://svgl.app).
// We show the logo of the harness — or, where the harness doesn't have its own
// brand on svgl, the company that owns it (e.g. Codex → OpenAI).
const HARNESS_INFO: Record<
  HarnessKind,
  { label: string; svglSlug: string | null }
> = {
  "claude-code": { label: "Claude Code", svglSlug: "claude" },
  cursor: { label: "Cursor", svglSlug: "cursor" },
  codex: { label: "Codex", svglSlug: "openai" },
  opencode: { label: "opencode", svglSlug: "opencode" },
  copilot: { label: "GitHub Copilot", svglSlug: "github copilot" },
  other: { label: "Agent", svglSlug: null },
};

export function harnessLabel(harness: HarnessKind, fallback?: string): string {
  if (harness === "other") return fallback?.trim() || HARNESS_INFO.other.label;
  return HARNESS_INFO[harness].label;
}

// svgl returns either a plain URL string for `route`, or a { light, dark } pair
// for theme-aware logos.
type SvglRoute = string | { light: string; dark: string };
interface SvglEntry {
  title: string;
  route: SvglRoute;
}

function pickRoute(route: SvglRoute, theme: "light" | "dark"): string {
  return typeof route === "string" ? route : route[theme];
}

// Memoize resolved logo URLs per harness+theme so we hit the network at most
// once each. A null result (no slug, or lookup failed/offline) is cached too so
// we don't retry on every render — the caller falls back to a generic icon.
const cache = new Map<string, string | null>();

export async function resolveHarnessLogo(
  harness: HarnessKind,
  theme: "light" | "dark",
): Promise<string | null> {
  const info = HARNESS_INFO[harness];
  if (!info.svglSlug) return null;
  const key = `${harness}:${theme}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(
      `https://svgl.app/api/svgs?search=${encodeURIComponent(info.svglSlug)}`,
    );
    if (!res.ok) throw new Error(`svgl ${res.status}`);
    const entries = (await res.json()) as SvglEntry[];
    const url = entries.length > 0 ? pickRoute(entries[0].route, theme) : null;
    cache.set(key, url);
    return url;
  } catch {
    // Offline / svgl unavailable — cache the miss and let the UI fall back.
    cache.set(key, null);
    return null;
  }
}
