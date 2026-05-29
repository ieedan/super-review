// Ctrl/Cmd+F find controller for the diff view.
//
// Match counts come from searching the raw patch text we've already cached
// per file — no DOM scanning at all for the count. DOM walks are bounded to
// a single file section's shadow root and only happen when we actually need
// to paint a highlight (current match navigation, or a file scrolling into
// view with an active query). That avoids the previous implementation's
// freeze, which came from a global mutation observer re-walking every diff's
// shadow DOM as Pierre streamed shiki tokens.

import { actions, app, getCachedDiff, setCachedDiff } from '$lib/store.svelte';
import { diffContextKey } from '@shared/diff-context';
import type { ChangedFile, DiffContext, DiffData } from '@shared/types';

const ALL_HIGHLIGHT = 'sr-find-match';
const CURRENT_HIGHLIGHT = 'sr-find-current';

const HIGHLIGHT_CSS = `
::highlight(${ALL_HIGHLIGHT}) {
  background-color: rgba(250, 204, 21, 0.35);
  color: inherit;
}
::highlight(${CURRENT_HIGHLIGHT}) {
  background-color: rgba(249, 115, 22, 0.6);
  color: inherit;
}
`;

interface FindState {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  matchCount: number;
  currentIndex: number;
  // Bumped every time the bar should claim focus (open, re-open via Cmd+F).
  focusNonce: number;
  // Bumped when an async load makes the count grow — lets the UI optionally
  // surface "still indexing" feedback. Not used yet but cheap to maintain.
  indexEpoch: number;
}

export const find = $state<FindState>({
  open: false,
  query: '',
  caseSensitive: false,
  matchCount: 0,
  currentIndex: -1,
  focusNonce: 0,
  indexEpoch: 0,
});

// One entry per file path → list of match positions inside the searchable
// text we derive from `cached.patch`. The same algorithm is used to walk
// the file's DOM when we need to paint, so the Nth match in DOM aligns with
// the Nth match here.
interface PatchMatch {
  start: number;
  end: number;
}
const matchesByFile = new Map<string, PatchMatch[]>();

// Order matters: navigation walks files in `app.changedFiles` order. We
// snapshot the list whenever we recompute so a render-during-recompute can't
// scramble indices.
let fileOrder: string[] = [];

// Flat (filePath, idxInFile) list — what `find.currentIndex` indexes into.
interface FlatMatch {
  filePath: string;
  idxInFile: number;
}
let flatMatches: FlatMatch[] = [];

interface RegisteredSection {
  sectionEl: HTMLElement;
  // Set by DiffFileSection. True iff the section is inside the IntersectionObserver
  // margin AND its host has been populated with Pierre's DOM.
  inView: boolean;
  // Bumped every time the section's Pierre render replaces / clears the DOM.
  // We use this to invalidate cached Range objects (which would dangle if
  // their underlying text nodes were removed).
  renderEpoch: number;
  // Find-only fast lane: run Pierre's render now, bypassing the global
  // FRAME_BUDGET_MS scheduler. Returns true if the section has rendered DOM
  // by the time it returns (already rendered or just rendered in-place).
  // Returns false if data hasn't been hydrated yet — caller should fall back
  // to the async wait-on-render path.
  renderIfNeeded?: () => boolean;
}
const sections = new Map<string, RegisteredSection>();

// Per-file Range cache used by the "all matches" yellow highlight. Keyed by
// file path; tagged with the renderEpoch it was built against.
interface BuiltRanges {
  epoch: number;
  ranges: Range[];
}
const builtRanges = new Map<string, BuiltRanges>();

let allHL: HighlightLike | null = null;
let currentHL: HighlightLike | null = null;
let highlightSheet: CSSStyleSheet | null = null;
const styledShadowRoots = new WeakSet<ShadowRoot>();

let scrollContainer: HTMLElement | null = null;

// Resolvers waiting for a specific file to finish rendering. Navigation
// parks here when the target file's DOM isn't built yet; `notifySectionState`
// flushes them when the renderEpoch changes.
const renderWaiters = new Map<string, Array<() => void>>();

// ──────────────────────────────────────────────────────────────────────────
// Custom Highlight API plumbing

interface HighlightLike {
  add(range: Range): void;
  delete(range: Range): boolean;
  clear(): void;
  size: number;
}

interface HighlightCtor {
  new (...ranges: Range[]): HighlightLike;
}

function getHighlights(): { all: HighlightLike; current: HighlightLike } | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return null;
  const HC = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  if (!HC) return null;
  if (!allHL) {
    allHL = new HC();
    currentHL = new HC();
    const highlights = (CSS as unknown as { highlights: Map<string, unknown> })
      .highlights;
    highlights.set(ALL_HIGHLIGHT, allHL);
    highlights.set(CURRENT_HIGHLIGHT, currentHL);
  }
  return { all: allHL, current: currentHL! };
}

function getHighlightSheet(): CSSStyleSheet | null {
  if (highlightSheet) return highlightSheet;
  if (typeof CSSStyleSheet === 'undefined') return null;
  try {
    highlightSheet = new CSSStyleSheet();
    highlightSheet.replaceSync(HIGHLIGHT_CSS);
    return highlightSheet;
  } catch {
    return null;
  }
}

function ensureShadowHighlightStyle(shadow: ShadowRoot): void {
  if (styledShadowRoots.has(shadow)) return;
  const sheet = getHighlightSheet();
  if (sheet) {
    try {
      shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
      styledShadowRoots.add(shadow);
      return;
    } catch {
      // fall through
    }
  }
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-sr-find', '');
  styleEl.textContent = HIGHLIGHT_CSS;
  shadow.appendChild(styleEl);
  styledShadowRoots.add(shadow);
}

// ──────────────────────────────────────────────────────────────────────────
// Patch parsing — pulls just the code text out of a unified diff. Excludes
// hunk headers ("@@ … @@") and the "\ No newline at end of file" marker.
// The leading +/-/space prefix is stripped so the user's search query matches
// the visible code, not the diff metadata.

function buildSearchableFromPatch(patch: string): string {
  const lines = patch.split('\n');
  const out: string[] = [];
  let inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('@@ ')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('\\')) continue;
    const ch = line.length > 0 ? line[0] : '';
    if (ch === '+' || ch === '-' || ch === ' ') out.push(line.slice(1));
    else out.push(line);
  }
  return out.join('\n');
}

function searchPatch(text: string, query: string, caseSensitive: boolean): PatchMatch[] {
  if (!query) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const results: PatchMatch[] = [];
  let idx = 0;
  while (true) {
    const f = hay.indexOf(needle, idx);
    if (f < 0) break;
    results.push({ start: f, end: f + needle.length });
    idx = f + Math.max(needle.length, 1);
  }
  return results;
}

function getCachedDiffFor(filePath: string): DiffData | null {
  if (!app.activeRepo) return null;
  const ctx = $state.snapshot(app.diffContext) as DiffContext;
  return getCachedDiff(app.activeRepo.id, ctx, filePath) ?? null;
}

// ──────────────────────────────────────────────────────────────────────────
// Index rebuild — recompute matches across every cached file.

function recomputeIndex(): void {
  matchesByFile.clear();
  fileOrder = app.changedFiles.map((f) => f.path);
  flatMatches = [];
  if (!find.query) {
    find.matchCount = 0;
    find.currentIndex = -1;
    return;
  }
  for (const path of fileOrder) {
    const d = getCachedDiffFor(path);
    if (!d) continue;
    const text = buildSearchableFromPatch(d.patch);
    const matches = searchPatch(text, find.query, find.caseSensitive);
    if (matches.length === 0) continue;
    matchesByFile.set(path, matches);
    for (let i = 0; i < matches.length; i++) {
      flatMatches.push({ filePath: path, idxInFile: i });
    }
  }
  find.matchCount = flatMatches.length;
  find.indexEpoch++;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-file DOM walk — same flatten-and-indexOf strategy as before, but
// rooted at a single section and skipping Pierre's gutter subtree so the
// match indices align with the patch-text indices.

interface NodeSegment {
  node: Text;
  start: number;
  length: number;
}
interface SearchableTree {
  text: string;
  segments: NodeSegment[];
}

const BLOCK_LEVEL_TAGS = new Set([
  'DIV', 'P', 'PRE', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'MAIN',
  'TABLE', 'TR', 'TD', 'TH', 'THEAD', 'TBODY', 'TFOOT', 'FORM', 'HR',
  'ADDRESS', 'FIELDSET', 'FIGURE', 'DETAILS', 'SUMMARY', 'DL', 'DT', 'DD',
]);

// Pierre's gutter wrapper carries `data-gutter=""`. Anything below that point
// is line-number / metadata content the user doesn't want searched (otherwise
// a query like "12" would light up every line number). The `data-gutter-buffer`
// elements are spacer cells with the same caveat.
function isExcludedFromSearch(el: Element): boolean {
  return (
    el.hasAttribute('data-gutter') ||
    el.hasAttribute('data-gutter-buffer') ||
    el.hasAttribute('data-gutter-utility-slot') ||
    // The file header lives inside our own `<header>` element; skip it.
    el.tagName === 'HEADER'
  );
}

function buildSearchableTreeForSection(root: Node): SearchableTree {
  const segments: NodeSegment[] = [];
  let text = '';

  const appendSep = (): void => {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
  };

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      const v = t.nodeValue ?? '';
      if (v.length > 0) {
        segments.push({ node: t, start: text.length, length: v.length });
        text += v;
      }
      return;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (isExcludedFromSearch(el)) return;
      const isBlock = BLOCK_LEVEL_TAGS.has(el.tagName);
      if (isBlock) appendSep();
      if (el.shadowRoot) {
        ensureShadowHighlightStyle(el.shadowRoot);
        visit(el.shadowRoot);
      }
      const children = el.childNodes;
      for (let i = 0; i < children.length; i++) visit(children[i]);
      if (isBlock) appendSep();
      return;
    }

    // DocumentFragment (incl. ShadowRoot) and other containers.
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) visit(children[i]);
  };

  visit(root);
  return { text, segments };
}

function segmentIndexAt(segments: NodeSegment[], pos: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const seg = segments[mid];
    if (pos < seg.start) hi = mid - 1;
    else if (pos >= seg.start + seg.length) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function rangeFor(segments: NodeSegment[], start: number, end: number): Range | null {
  if (end <= start) return null;
  const startIdx = segmentIndexAt(segments, start);
  const endIdx = segmentIndexAt(segments, end - 1);
  if (startIdx < 0 || endIdx < 0) return null;
  const startSeg = segments[startIdx];
  const endSeg = segments[endIdx];
  const r = document.createRange();
  try {
    r.setStart(startSeg.node, start - startSeg.start);
    r.setEnd(endSeg.node, end - endSeg.start);
    return r;
  } catch {
    return null;
  }
}

// Walk one file section's shadow DOM, search for the query, return one Range
// per match. The Nth Range here corresponds 1-1 with the Nth entry in
// matchesByFile[filePath] because both walk the same code text.
function buildRangesForSection(filePath: string): Range[] {
  const reg = sections.get(filePath);
  if (!reg || !find.query) return [];
  const tree = buildSearchableTreeForSection(reg.sectionEl);
  const needle = find.caseSensitive ? find.query : find.query.toLowerCase();
  const hay = find.caseSensitive ? tree.text : tree.text.toLowerCase();
  const ranges: Range[] = [];
  let idx = 0;
  while (true) {
    const f = hay.indexOf(needle, idx);
    if (f < 0) break;
    const r = rangeFor(tree.segments, f, f + needle.length);
    if (r) ranges.push(r);
    idx = f + Math.max(needle.length, 1);
  }
  return ranges;
}

// ──────────────────────────────────────────────────────────────────────────
// Highlight bookkeeping

function clearAllHighlights(): void {
  const hl = getHighlights();
  if (!hl) return;
  hl.all.clear();
  hl.current.clear();
  builtRanges.clear();
}

function dropFileRanges(filePath: string): void {
  const hl = getHighlights();
  if (!hl) return;
  const built = builtRanges.get(filePath);
  if (!built) return;
  for (const r of built.ranges) hl.all.delete(r);
  builtRanges.delete(filePath);
}

// Build (or refresh) yellow highlights for one file. No-op if the file's
// existing build matches the current renderEpoch.
function refreshFileHighlights(filePath: string): void {
  const reg = sections.get(filePath);
  if (!reg) return;
  const hl = getHighlights();
  if (!hl) return;
  if (!find.open || !find.query || !reg.inView) {
    dropFileRanges(filePath);
    return;
  }
  const existing = builtRanges.get(filePath);
  if (existing && existing.epoch === reg.renderEpoch) return;
  // Stale build — remove its ranges before re-walking.
  if (existing) {
    for (const r of existing.ranges) hl.all.delete(r);
  }
  const ranges = buildRangesForSection(filePath);
  builtRanges.set(filePath, { epoch: reg.renderEpoch, ranges });
  for (const r of ranges) hl.all.add(r);
}

function refreshAllInViewHighlights(): void {
  for (const [path, reg] of sections) {
    if (reg.inView) refreshFileHighlights(path);
    else dropFileRanges(path);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Navigation — scrolls the target file into view, expands it if collapsed,
// waits for its diff to render, then sets the orange current-match highlight.

function waitForRender(filePath: string): Promise<void> {
  const reg = sections.get(filePath);
  // Already rendered — the section reported a non-zero renderEpoch.
  if (reg && reg.renderEpoch > 0 && reg.inView) return Promise.resolve();
  return new Promise((resolve) => {
    const list = renderWaiters.get(filePath) ?? [];
    list.push(resolve);
    renderWaiters.set(filePath, list);
    // Safety net: time out so navigation never hangs forever if the file
    // never reports a render (e.g. binary / truncated).
    window.setTimeout(() => {
      const cur = renderWaiters.get(filePath);
      if (!cur) return;
      const idx = cur.indexOf(resolve);
      if (idx >= 0) cur.splice(idx, 1);
      resolve();
    }, 1500);
  });
}

function flushRenderWaiters(filePath: string): void {
  const list = renderWaiters.get(filePath);
  if (!list || list.length === 0) return;
  renderWaiters.delete(filePath);
  for (const fn of list) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
}

function elementForScroll(node: Node): Element | null {
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  const parent = node.parentElement;
  if (parent) return parent;
  const root = node.getRootNode();
  if (root instanceof ShadowRoot) return root.host as Element;
  return null;
}

// Paint the orange "current" highlight for the match at `index` without
// touching scroll. Used while the user is typing — yellow highlights update
// across in-view files, and the current pin moves silently. If the target
// file isn't rendered (off-screen or never opened), there's no Range to
// paint, so we just remember the index and let nextMatch/prevMatch fill it
// in when the user actually navigates.
function paintCurrentNoScroll(index: number): void {
  const hl = getHighlights();
  if (!hl) return;
  hl.current.clear();
  if (index < 0 || index >= flatMatches.length) {
    find.currentIndex = -1;
    return;
  }
  find.currentIndex = index;
  const target = flatMatches[index];
  const reg = sections.get(target.filePath);
  if (!reg || !reg.inView || reg.renderEpoch === 0) return;
  refreshFileHighlights(target.filePath);
  const built = builtRanges.get(target.filePath);
  const range = built?.ranges[target.idxInFile];
  if (range) hl.current.add(range);
}

// Try to navigate to `index` synchronously. Returns true if it handled
// everything (file already rendered, ranges already built — just a Range
// swap). Returns false if the slow async path is needed (file collapsed,
// off-screen, ranges missing). Going synchronous matters because pressing
// Enter to step through matches in the same file would otherwise flash the
// orange highlight off across the `await` microtask boundary.
function tryNavigateSync(index: number): boolean {
  const hl = getHighlights();
  if (!hl) return false;
  if (index < 0 || index >= flatMatches.length) return false;
  const target = flatMatches[index];
  if (app.collapsedFiles.has(target.filePath)) return false;
  const reg = sections.get(target.filePath);
  if (!reg || !reg.inView || reg.renderEpoch === 0) return false;
  const built = builtRanges.get(target.filePath);
  if (!built || built.epoch !== reg.renderEpoch) {
    // Ranges haven't been walked yet for this render — build them now and
    // keep the path synchronous. The walk is cheap for one file.
    refreshFileHighlights(target.filePath);
    const rebuilt = builtRanges.get(target.filePath);
    if (!rebuilt) return false;
    const range = rebuilt.ranges[target.idxInFile];
    if (!range) return false;
    find.currentIndex = index;
    hl.current.clear();
    hl.current.add(range);
    if (!isRangeInViewport(range)) {
      const el = elementForScroll(range.startContainer);
      if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    }
    return true;
  }
  const range = built.ranges[target.idxInFile];
  if (!range) return false;
  find.currentIndex = index;
  hl.current.clear();
  hl.current.add(range);
  if (!isRangeInViewport(range)) {
    const el = elementForScroll(range.startContainer);
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  }
  return true;
}

// Full navigation: expand the file if needed, scroll its section into view,
// wait for Pierre to render, paint orange, then scroll the specific range to
// the viewport center. Used by Enter / next / prev when the sync path can't
// satisfy the nav (off-screen file, collapsed file, never-rendered file).
async function navigateTo(index: number): Promise<void> {
  if (tryNavigateSync(index)) return;

  const hl = getHighlights();
  if (!hl) return;
  hl.current.clear();
  if (index < 0 || index >= flatMatches.length) {
    find.currentIndex = -1;
    return;
  }
  find.currentIndex = index;
  const target = flatMatches[index];

  if (app.collapsedFiles.has(target.filePath)) {
    void actions.toggleFileCollapsed(target.filePath, false);
  }

  const reg = sections.get(target.filePath);
  if (reg) {
    reg.sectionEl.scrollIntoView({ block: 'start', behavior: 'auto' });
    // Skip the FRAME_BUDGET_MS render scheduler queue for the navigation
    // target. Without this, the target's render sits behind every other
    // file the scrollIntoView swept into the IntersectionObserver margin,
    // and the highlight can take seconds to appear on large diff sets.
    reg.renderIfNeeded?.();
  }

  await waitForRender(target.filePath);

  refreshFileHighlights(target.filePath);
  const built = builtRanges.get(target.filePath);
  if (!built) return;
  const range = built.ranges[target.idxInFile];
  if (!range) return;

  hl.current.add(range);
  if (!isRangeInViewport(range)) {
    const el = elementForScroll(range.startContainer);
    if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  }
}

// Is a Range's first line already visible inside the scroll container?
// Used to avoid re-centering a match the user is already looking at.
function isRangeInViewport(range: Range): boolean {
  if (!scrollContainer) return false;
  let rect: DOMRect;
  try {
    rect = range.getBoundingClientRect();
  } catch {
    return false;
  }
  if (rect.width === 0 && rect.height === 0) return false;
  const containerRect = scrollContainer.getBoundingClientRect();
  return (
    rect.top >= containerRect.top &&
    rect.bottom <= containerRect.bottom
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Public API

export function setFindScrollContainer(el: HTMLElement | null): void {
  scrollContainer = el;
}

export function registerFindSection(
  filePath: string,
  sectionEl: HTMLElement,
  hooks?: { renderIfNeeded?: () => boolean },
): () => void {
  sections.set(filePath, {
    sectionEl,
    inView: false,
    renderEpoch: 0,
    renderIfNeeded: hooks?.renderIfNeeded,
  });
  // If find is already active, the file may have matches to fold in.
  if (find.open && find.query) {
    queueIndexRecompute();
  }
  return () => {
    dropFileRanges(filePath);
    sections.delete(filePath);
    flushRenderWaiters(filePath);
  };
}

export function notifySectionState(
  filePath: string,
  patch: { inView?: boolean; bumpRenderEpoch?: boolean; dataLoaded?: boolean },
): void {
  const reg = sections.get(filePath);
  if (!reg) return;
  let changed = false;
  if (patch.inView != null && patch.inView !== reg.inView) {
    reg.inView = patch.inView;
    changed = true;
  }
  if (patch.bumpRenderEpoch) {
    reg.renderEpoch++;
    changed = true;
    flushRenderWaiters(filePath);
  }
  if (patch.dataLoaded) {
    // New cached diff data for this file — pull its matches into the index.
    queueIndexRecompute();
  }
  if (!changed) return;
  if (!find.open) return;
  refreshFileHighlights(filePath);
}

// Debounced index recompute so a flurry of section loads / scroll events
// during initial mount doesn't redo the scan dozens of times in a tick.
let indexScheduled = false;
function queueIndexRecompute(): void {
  if (indexScheduled) return;
  indexScheduled = true;
  queueMicrotask(() => {
    indexScheduled = false;
    if (!find.open) return;
    const prevTarget = flatMatches[find.currentIndex] ?? null;
    recomputeIndex();
    // Try to keep the current selection stable across recompute (e.g. when
    // a new file's matches are added to the front of the list).
    let preservedIdx = -1;
    if (prevTarget) {
      const newIdx = flatMatches.findIndex(
        (m) =>
          m.filePath === prevTarget.filePath && m.idxInFile === prevTarget.idxInFile,
      );
      if (newIdx >= 0) preservedIdx = newIdx;
      else if (flatMatches.length > 0)
        preservedIdx = Math.min(find.currentIndex, flatMatches.length - 1);
    } else if (flatMatches.length > 0) {
      preservedIdx = 0;
    }
    refreshAllInViewHighlights();
    // Repaint the orange pin on the (possibly relocated) current match. Old
    // Ranges would dangle after a rebuild — the no-scroll variant just
    // re-derives from current state.
    if (preservedIdx >= 0) paintCurrentNoScroll(preservedIdx);
    else {
      const hl = getHighlights();
      hl?.current.clear();
      find.currentIndex = -1;
    }
  });
}

// In-progress preload session — incremented each time openFind kicks one off
// so stale fetches from a previous session bail out cleanly.
let preloadSession = 0;

// Fetch patches for any changed file that isn't in the diff cache yet, so
// the match count covers ALL files, not just the ones the user has scrolled
// past. Throttled concurrency keeps the IPC queue manageable on large diffs.
async function preloadAllPatches(): Promise<void> {
  if (!app.activeRepo) return;
  const session = ++preloadSession;
  const repo = app.activeRepo;
  const ctx = $state.snapshot(app.diffContext) as DiffContext;
  const ctxKey = diffContextKey(ctx);

  const queue: ChangedFile[] = [];
  for (const f of app.changedFiles) {
    if (f.isBinary) continue;
    if (getCachedDiff(repo.id, ctx, f.path)) continue;
    queue.push(f);
  }
  if (queue.length === 0) return;

  const CONCURRENCY = 4;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      if (session !== preloadSession) return; // superseded — bail
      if (!find.open) return; // user closed find
      const file = queue[cursor++];
      try {
        const d = await window.api.git.getDiff(repo.id, file.path, ctx);
        if (session !== preloadSession) return;
        if (!app.activeRepo || app.activeRepo.id !== repo.id) return;
        const curKey = diffContextKey($state.snapshot(app.diffContext) as DiffContext);
        if (curKey !== ctxKey) return;
        setCachedDiff(repo.id, ctx, file.path, d);
        // Fold the new patch's matches into the index. Debounced so 100
        // concurrent completions don't trigger 100 recomputes.
        queueIndexRecompute();
      } catch {
        // Skip files that fail to load — preload is best-effort.
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
}

export function openFind(): void {
  find.open = true;
  find.focusNonce++;
  // Always kick off a preload so unmounted files contribute to the count.
  // Safe to call repeatedly — cached files are skipped, in-flight session
  // is superseded by the new one.
  void preloadAllPatches();
  if (find.query) {
    recomputeIndex();
    refreshAllInViewHighlights();
    // Bar re-opened with a prefilled query — surface the first match the
    // same way a fresh search would.
    if (find.matchCount > 0 && find.currentIndex < 0) void navigateTo(0);
  }
}

export function closeFind(): void {
  find.open = false;
  find.matchCount = 0;
  find.currentIndex = -1;
  flatMatches = [];
  matchesByFile.clear();
  clearAllHighlights();
  // Bump the preload session so any in-flight workers stop the next time
  // they check.
  preloadSession++;
  // Don't drop sections — they're still mounted; just stop highlighting.
}

// Capture the current orange match's stable identity (file + patch-text
// offset) before a rebuild. After the rebuild we try to find the same
// underlying position in the new match list — if it's still a match the
// user keeps their place; if it's gone we navigate them to the first match.
interface PreservedAnchor {
  filePath: string;
  patchStart: number;
}

function snapshotAnchor(): PreservedAnchor | null {
  if (find.currentIndex < 0) return null;
  const prev = flatMatches[find.currentIndex];
  if (!prev) return null;
  const fileMatches = matchesByFile.get(prev.filePath);
  const m = fileMatches?.[prev.idxInFile];
  if (!m) return null;
  return { filePath: prev.filePath, patchStart: m.start };
}

function findAnchorAfterRebuild(anchor: PreservedAnchor | null): number {
  if (!anchor) return -1;
  const fileMatches = matchesByFile.get(anchor.filePath);
  if (!fileMatches) return -1;
  const inFileIdx = fileMatches.findIndex((m) => m.start === anchor.patchStart);
  if (inFileIdx < 0) return -1;
  return flatMatches.findIndex(
    (m) => m.filePath === anchor.filePath && m.idxInFile === inFileIdx,
  );
}

// After a query/case-sensitivity change, settle on a current match and
// navigate (scroll) to it iff the user's previous anchor is gone. This
// mirrors what browsers do: typing scrolls to the first match unless your
// current match is still valid.
function settleAfterQueryChange(prev: PreservedAnchor | null): void {
  const hl = getHighlights();
  if (find.matchCount === 0) {
    hl?.current.clear();
    find.currentIndex = -1;
    return;
  }
  const preserved = findAnchorAfterRebuild(prev);
  if (preserved >= 0) {
    paintCurrentNoScroll(preserved);
    return;
  }
  // No equivalent match — scroll to #1 so the user can see where the new
  // query landed. navigateTo's sync fast path keeps this snappy when the
  // first match is already in a rendered visible file.
  void navigateTo(0);
}

let queryDebounce: number | null = null;
export function setQuery(q: string): void {
  if (find.query === q) return;
  find.query = q;
  if (!find.open) return;
  if (queryDebounce != null) window.clearTimeout(queryDebounce);
  // Tiny debounce — the work itself is fast for cached patches, but coalescing
  // back-to-back keystrokes keeps typing snappy when many files are loaded.
  queryDebounce = window.setTimeout(() => {
    queryDebounce = null;
    if (!q) {
      flatMatches = [];
      matchesByFile.clear();
      find.matchCount = 0;
      find.currentIndex = -1;
      clearAllHighlights();
      return;
    }
    const anchor = snapshotAnchor();
    recomputeIndex();
    refreshAllInViewHighlights();
    settleAfterQueryChange(anchor);
  }, 80);
}

export function toggleCaseSensitive(): void {
  find.caseSensitive = !find.caseSensitive;
  if (!find.open || !find.query) return;
  const anchor = snapshotAnchor();
  recomputeIndex();
  refreshAllInViewHighlights();
  settleAfterQueryChange(anchor);
}

export function nextMatch(): void {
  if (flatMatches.length === 0) return;
  const cur = find.currentIndex;
  const next = cur < 0 ? 0 : (cur + 1) % flatMatches.length;
  void navigateTo(next);
}

export function prevMatch(): void {
  if (flatMatches.length === 0) return;
  const cur = find.currentIndex;
  const prev =
    cur < 0
      ? flatMatches.length - 1
      : (cur - 1 + flatMatches.length) % flatMatches.length;
  void navigateTo(prev);
}

// Used by old call site in DiffView — kept as an alias so we don't have to
// touch every importer. The new module relies on per-section registration,
// not a single root pointer, so this only stores the scroll container ref.
export function setFindRoot(el: HTMLElement | null): void {
  setFindScrollContainer(el);
}
