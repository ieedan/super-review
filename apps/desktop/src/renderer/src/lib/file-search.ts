import picomatch from 'picomatch';

// Matching for the shared changed-files search query. Used by both the sidebar
// file list (where the query is typed) and the diff view (which hides sections
// for files that don't match) so the two stay in sync.
//
// Plain-text queries do a case-insensitive substring match on the full path —
// the friendly default for "just type part of a name". Queries containing glob
// metacharacters (`* ? [ ] { }`) are matched with picomatch instead:
//   - a pattern with no slash (e.g. `*.svelte`) matches the file's basename, so
//     it finds matches anywhere in the tree;
//   - a pattern with a slash (e.g. `src/**`) matches the full path.
// Matching is case-insensitive either way. The compiled matcher is cached so a
// query is only parsed once across every file it's tested against.

const GLOB_META = /[*?[\]{}]/;

let cachedQuery: string | null = null;
let cachedMatcher: ((path: string) => boolean) | null = null;
let cachedUseBasename = false;

export function matchesFileQuery(path: string, rawQuery: string): boolean {
  const q = rawQuery.trim();
  if (!q) return true;
  if (!GLOB_META.test(q)) {
    return path.toLowerCase().includes(q.toLowerCase());
  }
  if (q !== cachedQuery) {
    cachedQuery = q;
    cachedMatcher = picomatch(q, { nocase: true, dot: true });
    cachedUseBasename = !q.includes('/');
  }
  return cachedMatcher!(cachedUseBasename ? basename(path) : path);
}

function basename(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}
