// Deciding when a file's "seen" mark can carry across diff contexts. Pure data
// logic (no Electron / electron-store), so it can be unit tested directly and
// reused by the desktop main process.
//
// A seen mark is stamped with the file's diff signature at mark-seen time:
// `oid:<base>..<dst>` (both blob OIDs; an added file has an empty base). The same
// file viewed under a different context (unstaged vs branch vs PR) can carry the
// mark when the *same span of blob OIDs* was already reviewed, either directly or
// through a chain of reviewed hops that join on identical OIDs.

// A stored seen entry as it lives on disk: a path→signature map, or the legacy
// filePath[] shape (no signatures) written by older builds.
export type SeenEntry = Record<string, string> | string[] | undefined;

// All seen marks for one repo, keyed by context.
export type SeenByContext = Record<string, SeenEntry>;

// Coerce a stored seen entry into a path→signature map, migrating the legacy
// filePath[] shape (signatures become '').
export function normalizeSeenEntry(raw: SeenEntry): Record<string, string> {
	if (!raw) return {};
	if (Array.isArray(raw)) return Object.fromEntries(raw.map((p) => [p, '']));
	return { ...raw };
}

// Split a seen signature into its `<base>` and `<dst>` blob OIDs, tolerating the
// `oid:` prefix that the renderer writes. Returns null for stat-fallback or bare
// signatures (no `..`), which can't prove a whole-diff match.
export function parseDiffSig(sig: string | undefined): { base: string; dst: string } | null {
	if (!sig) return null;
	const body = sig.startsWith('oid:') ? sig.slice(4) : sig;
	const i = body.indexOf('..');
	if (i === -1) return null;
	return { base: body.slice(0, i), dst: body.slice(i + 2) };
}

// Whether two blob OIDs name the same content, tolerating git's variable-length
// abbreviation. `git diff --raw`/patch output shortens OIDs to the shortest
// unique prefix, and that length grows as the repo gains objects — so the same
// blob can serialize as `2b7a412b` when a file is marked seen and `2b7a412b8f…`
// after the next commit. One being a (non-empty) prefix of the other means the
// same blob: a real content change yields a wholly different hash, never a
// prefix. Empty matches empty (the missing base side of an added file). This is
// the safety net that keeps an unchanged file marked seen across that drift, and
// across the upgrade from abbreviated to full OIDs for already-stored marks.
export function oidsMatch(a: string, b: string): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.length <= b.length ? b.startsWith(a) : a.startsWith(b);
}

// Whether the current diff `target` (base..dst) for `path` is fully covered by a
// continuous chain of diffs already marked seen. Every stored `<base>..<dst>` for
// the path becomes a directed edge base→dst; we then ask whether target.base
// reaches target.dst through them.
//
// A direct match is just the one-hop case. The multi-hop case is the point:
// review the whole branch diff (mergebase..commit1), then review a follow-up edit
// (commit1..commit2) on the unstaged tab, then commit it — the new branch diff is
// mergebase..commit2, and the two reviewed hops span it exactly. It's safe
// because each hop joins on an identical blob OID, so the chain leaves no
// unreviewed gap between base and dst.
//
// `includeContextKey` selects which marks count as edges. For *inheriting* a mark
// into a context, only *other* contexts' marks count (false). For *retaining* a
// mark in the context whose diff just changed, this context's own prior reviewed
// diff is a legitimate hop too (true), so the branch's earlier-reviewed state can
// bridge to the new commit.
export function diffChainCovers(
	byCtx: SeenByContext,
	contextKey: string,
	path: string,
	target: { base: string; dst: string },
	includeContextKey = false
): boolean {
	const adj = new Map<string, Set<string>>();
	for (const [otherKey, otherSeen] of Object.entries(byCtx)) {
		if (otherKey === contextKey && !includeContextKey) continue;
		const edge = parseDiffSig(normalizeSeenEntry(otherSeen)[path]);
		if (!edge) continue;
		const from = adj.get(edge.base) ?? adj.set(edge.base, new Set()).get(edge.base)!;
		from.add(edge.dst);
	}
	const queue = [target.base];
	const visited = new Set(queue);
	while (queue.length > 0) {
		const oid = queue.shift()!;
		if (oid === target.dst) return true;
		for (const next of adj.get(oid) ?? []) {
			if (visited.has(next)) continue;
			visited.add(next);
			queue.push(next);
		}
	}
	return false;
}

// Decide which currently-seen files should *keep* their seen mark even though
// their diff just changed (a new commit, more edits). `fileSigs` maps each file
// to its fresh `<base>..<dst>` signature.
//
// Normally a changed diff is unmarked so it resurfaces for re-review. But if the
// new diff is still spanned by a continuous chain of reviewed diffs — this
// context's own prior reviewed state plus what was reviewed in other contexts —
// then every byte of it has already been seen, so it should stay seen. This is
// the case the unmark-on-change step would otherwise destroy: it deletes the
// context's prior reviewed edge before the chain can use it.
//
// Returns the paths to retain; the caller rolls each one's stored signature
// forward to the new value (the now-current reviewed state) and leaves it seen.
export function computeRetainedSeen(
	byCtx: SeenByContext,
	contextKey: string,
	fileSigs: Record<string, string>
): string[] {
	const seenHere = normalizeSeenEntry(byCtx[contextKey]);
	const retained: string[] = [];
	for (const [path, newSig] of Object.entries(fileSigs)) {
		const stored = seenHere[path];
		// Only files currently seen *here* are at risk of an unmark-on-change.
		if (!stored) continue;
		const target = parseDiffSig(newSig);
		// Without whole-diff OIDs we can't prove coverage; leave the normal
		// (content-based) unmark logic to decide.
		if (!target) continue;
		// Unchanged — not at risk, nothing to retain.
		if (stored === newSig) continue;
		// The diff changed. Keep it only if a reviewed chain still spans it,
		// counting this context's own prior reviewed edge.
		if (diffChainCovers(byCtx, contextKey, path, target, true)) retained.push(path);
	}
	return retained;
}

// Decide which currently-shown files should inherit a seen mark. `fileDiffSigs`
// maps each file to its `<base>..<dst>` signature; a file inherits when its diff
// is covered by seen marks under another context (directly or via a chain).
//
// `alreadyApplied` is the per-context record of diffs we auto-marked on a prior
// refresh: if the user has since un-seen one, its path still maps to that exact
// signature, so we skip it instead of re-inheriting every refresh. (A genuinely
// new diff has a different signature and is eligible again.)
//
// Returns the paths to apply; the caller persists the marks and the guard record.
export function computeInheritedSeen(
	byCtx: SeenByContext,
	contextKey: string,
	alreadyApplied: Record<string, string>,
	fileDiffSigs: Record<string, string>
): string[] {
	const seenHere = normalizeSeenEntry(byCtx[contextKey]);
	const applied: string[] = [];
	for (const [path, sig] of Object.entries(fileDiffSigs)) {
		const target = parseDiffSig(sig);
		// Only a whole-diff signature (`<base>..<dst>`) can carry across contexts.
		if (!target) continue;
		// Already seen here (directly or from a prior inherit) — nothing to do.
		if (seenHere[path]) continue;
		// We already auto-applied this exact diff once; respect the user's choice
		// (they un-saw it, or it's gone) instead of re-inheriting every refresh.
		if (alreadyApplied[path] === sig) continue;
		if (!diffChainCovers(byCtx, contextKey, path, target)) continue;
		applied.push(path);
	}
	return applied;
}
