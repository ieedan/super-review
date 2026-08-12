// Makes Pierre's worker-side highlight cache actually usable for diffs, and
// lets us warm it before a diff is on screen.
//
// Pierre keys both its highlighted-AST cache and its `primeDiffHighlightCache`
// entry point solely off `FileDiffMetadata.cacheKey`, and `parseDiffFromFile`
// only produces one when BOTH file objects it's handed carry a `cacheKey`. The
// diff renderer used to pass bare `{ name, contents }` pairs, so every diff came
// back with `cacheKey: undefined` — which meant the cache could never hit and
// priming was impossible. Every render re-tokenized the file from scratch on a
// worker, and the first paint was always plain text until the highlighted AST
// came back. (The Raw view already did this properly; see `rawFileContents` in
// DiffFileSection.)
//
// The keys here are derived from the *content*, not from where the diff came
// from. That's what lets the store's prefetch and the section's render agree on
// a key without coordinating: the prefetch runs long before the section has
// loaded anything of its own. It also means identical content shares highlight
// work across tabs and contexts — the same file on the Branch and Unstaged tabs
// tokenizes once.

import { parseDiffFromFile, type FileContents, type FileDiffMetadata } from '@pierre/diffs';
import type { DiffData } from '@super-review/core/types';
import { getDiffWorkerPool } from '@super-review/ui/diff-worker-pool';

// cyrb53: a fast, well-distributed non-cryptographic 53-bit hash. We only need
// "different content ⇒ different key with overwhelming likelihood", and this
// runs in a single pass over the string — trivial next to the `createTwoFilesPatch`
// the parse below does over the same content.
function hashContents(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// The name is part of the key because highlighting is language-driven: the same
// bytes as `a.ts` and `a.py` must not share a cached AST. Length is folded in as
// a cheap extra discriminator.
function sideKey(name: string, contents: string): string {
	return `${name}:${contents.length}:${hashContents(contents)}`;
}

// The old/new pair handed to Pierre, with the cache keys that make its highlight
// cache work. Single source of truth: the renderer and the prime path must build
// identical pairs or they'd key differently and never share a result.
export function diffFilePair(diff: DiffData): { oldFile: FileContents; newFile: FileContents } {
	const oldName = diff.file.oldPath ?? diff.file.path;
	const newName = diff.file.path;
	return {
		oldFile: {
			name: oldName,
			contents: diff.oldContents,
			cacheKey: sideKey(oldName, diff.oldContents)
		},
		newFile: {
			name: newName,
			contents: diff.newContents,
			cacheKey: sideKey(newName, diff.newContents)
		}
	};
}

// Parsed metadata, memoized by the same content-derived key Pierre caches under.
// Pierre treats `FileDiffMetadata` as immutable input — expansion state and
// render caches live on the renderer instance, not on the metadata — so handing
// the same object to several sections (or to a prime and then a render) is safe.
//
// Bounded and evicted oldest-first: each entry holds the diff's hunk data, which
// scales with the diff, so this can't be allowed to grow with the session.
const METADATA_CACHE_LIMIT = 30;
const metadataCache = new Map<string, FileDiffMetadata>();

function rememberMetadata(key: string, meta: FileDiffMetadata): void {
	metadataCache.set(key, meta);
	while (metadataCache.size > METADATA_CACHE_LIMIT) {
		const oldest = metadataCache.keys().next();
		if (oldest.done) break;
		metadataCache.delete(oldest.value);
	}
}

// Parse a diff into Pierre's metadata, reusing an earlier parse of the same
// content when there is one. Throws exactly like `parseDiffFromFile` (notably on
// identical sides), so callers keep their existing error handling.
export function parseDiffMetadata(
	oldFile: FileContents,
	newFile: FileContents
): FileDiffMetadata | null | undefined {
	const key =
		oldFile.cacheKey && newFile.cacheKey ? `${oldFile.cacheKey}:${newFile.cacheKey}` : null;
	if (key) {
		const hit = metadataCache.get(key);
		// Re-insert so eviction is least-recently-used rather than insertion order.
		if (hit) {
			metadataCache.delete(key);
			metadataCache.set(key, hit);
			return hit;
		}
	}
	const meta = parseDiffFromFile(oldFile, newFile);
	if (key && meta) rememberMetadata(key, meta);
	return meta;
}

// Ask the worker pool to tokenize a diff we expect to show shortly, so its
// highlighted AST is already in Pierre's cache when the section renders and the
// first paint comes up highlighted instead of plain. Best-effort in every
// respect: no pool, nothing to diff, or a parse failure all just mean the
// section highlights the usual way once it's on screen.
export function primeDiffHighlight(diff: DiffData): void {
	const pool = getDiffWorkerPool();
	if (!pool || !pool.isWorkingPool()) return;
	if (diff.file.isBinary || diff.truncated) return;
	// Identical sides have nothing to diff — `parseDiffFromFile` throws on them.
	if (diff.oldContents === diff.newContents) return;
	const { oldFile, newFile } = diffFilePair(diff);
	try {
		const meta = parseDiffMetadata(oldFile, newFile);
		if (meta) pool.primeDiffHighlightCache(meta);
	} catch {
		// Ignored — the section surfaces any real parse error when it renders.
	}
}
