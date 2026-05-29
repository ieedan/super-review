import { simpleGit, type SimpleGit } from "simple-git";
import { createHash } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  BranchInfo,
  ChangedFile,
  DiffContext,
  DiffData,
  FileStatus,
  GitIdentity,
  RepoInfo,
} from "@shared/types.js";

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function repoIdFromPath(p: string): string {
  return createHash("sha1").update(path.resolve(p)).digest("hex").slice(0, 12);
}

export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const git = simpleGit(dirPath);
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

// Directories we never descend into while scanning a folder for repos: package
// caches, build output, and other VCS metadata. They never contain a repo we
// want to surface and can hold tens of thousands of files.
const SCAN_IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  "Pods",
]);

// How deep below the chosen folder we'll look. Repos are normally checked out a
// level or two down (e.g. ~/code/<repo> or ~/code/<org>/<repo>); a bound keeps a
// stray deep tree from turning the scan into a full-disk walk.
const MAX_SCAN_DEPTH = 4;

// Recursively find git repositories under `rootPath`. A directory containing a
// `.git` entry is treated as a repo and is not descended into (so nested repos
// inside a checkout aren't double-counted). Returns absolute repo paths.
export async function scanForRepos(rootPath: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    // `.git` is a directory in a normal checkout and a file in a worktree or
    // submodule — either marks `dir` as a repository.
    let isRepo = false;
    try {
      await fs.stat(path.join(dir, ".git"));
      isRepo = true;
    } catch {
      // No `.git` here — keep descending.
    }
    if (isRepo) {
      found.push(dir);
      return;
    }
    if (depth >= MAX_SCAN_DEPTH) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // Unreadable directory (permissions, etc.) — skip it.
    }

    const subdirs = entries.filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        !SCAN_IGNORE_DIRS.has(e.name),
    );
    await Promise.all(
      subdirs.map((e) => walk(path.join(dir, e.name), depth + 1)),
    );
  }

  await walk(path.resolve(rootPath), 0);
  return found;
}

// Names we're willing to treat as a repo icon, ranked best → worst. A real
// favicon beats a generic logo; `app-icon`/`AppIcon` cover macOS bundles.
const ICON_BASE_PRIORITY: Record<string, number> = {
  favicon: 0,
  icon: 1,
  "app-icon": 2,
  appicon: 2,
  logo: 3,
};
const ICON_EXT_PRIORITY: Record<string, number> = {
  svg: 0,
  png: 1,
  ico: 2,
};
// Directory names we always skip — too noisy, too big, or vendored output.
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  ".angular",
  "dist",
  "out",
  "build",
  "target",
  "coverage",
  "tmp",
  "temp",
  ".idea",
  ".vscode",
]);

// Directories whose icons rarely represent the repo's brand. We still scan
// into them (so single-example repos resolve), but apply a large score
// penalty so a favicon in `apps/docs/` beats one in `examples/svelte/`.
const NON_CANONICAL_SEGMENTS = new Set([
  "examples",
  "example",
  "demo",
  "demos",
  "sample",
  "samples",
  "fixture",
  "fixtures",
  "test",
  "tests",
  "__tests__",
  "e2e",
  "playground",
  "sandbox",
  "storybook",
  ".storybook",
]);

// electron-builder config filenames. Any of these at a directory marks it as
// an Electron project root; `package.json` deps / a `build` key also count
// (see electronIconIn).
const ELECTRON_CONFIG_FILES = new Set([
  "electron-builder.yml",
  "electron-builder.yaml",
  "electron-builder.json",
  "electron-builder.json5",
  "electron-builder.js",
  "electron-builder.cjs",
  "electron-builder.mjs",
  "electron-builder.ts",
]);

// Electron apps have no favicon; their brand icon is whatever electron-builder
// packages from its buildResources dir (default `build/`) as icon.png/.ico.
// That dir is in SKIP_DIRS — build output for most projects — so the generic
// scan never reaches it. Detect an Electron project at `dir` and return its
// build icon if present. Bounded to one package.json read + a few stat()s.
async function electronIconIn(
  dir: string,
  entries: Dirent[],
): Promise<string | undefined> {
  let isElectron = entries.some(
    (e) => e.isFile() && ELECTRON_CONFIG_FILES.has(e.name.toLowerCase()),
  );
  let buildResources = "build";
  if (entries.some((e) => e.isFile() && e.name === "package.json")) {
    try {
      const pkg = JSON.parse(
        await fs.readFile(path.join(dir, "package.json"), "utf8"),
      );
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.electron || deps["electron-builder"] || pkg.build) {
        isElectron = true;
      }
      const br = pkg.build?.directories?.buildResources;
      if (typeof br === "string" && br) buildResources = br;
    } catch {
      // unreadable / non-JSON package.json — rely on config-file detection
    }
  }
  if (!isElectron) return undefined;
  // Prefer png/ico (renderable in an <img>); .icns isn't, so skip it. Covers
  // the buildResources icon and the linux `icons/` dir convention.
  for (const rel of [
    `${buildResources}/icon.png`,
    `${buildResources}/icon.ico`,
    `${buildResources}/icons/512x512.png`,
  ]) {
    const candidate = path.join(dir, rel);
    try {
      const st = await fs.stat(candidate);
      if (st.isFile() && st.size > 0 && st.size <= 256 * 1024) return candidate;
    } catch {
      // not present — try the next
    }
  }
  return undefined;
}

// Walk the repo up to MAX_DEPTH looking for the best-ranked icon. Bounded
// because monorepos can have thousands of subdirs and we don't want to stall
// the picker. A "best so far" tracker lets us short-circuit when we hit the
// top-priority candidate (favicon.svg).
async function findRepoIcon(repoPath: string): Promise<string | undefined> {
  const MAX_DEPTH = 5;
  let bestPath: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  async function visit(
    dir: string,
    depth: number,
    nonCanonical: boolean,
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // An Electron app's build icon (build/icon.png) sits in a SKIP_DIRS dir the
    // loop below won't descend into — check for it explicitly and score it as
    // authoritatively as a favicon (basePriority 0).
    const elIcon = await electronIconIn(dir, entries);
    if (elIcon) {
      const ext = path.extname(elIcon).slice(1).toLowerCase();
      const score =
        (ICON_EXT_PRIORITY[ext] ?? 1) * 10 + depth + (nonCanonical ? 500 : 0);
      if (score < bestScore) {
        bestScore = score;
        bestPath = elIcon;
      }
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".well-known") {
        // skip dotfiles/dotdirs except a few we explicitly allow above
        if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
        if (entry.isDirectory()) continue;
        // dotfile — not an icon
        continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (depth >= MAX_DEPTH) continue;
        const childNonCanonical =
          nonCanonical || NON_CANONICAL_SEGMENTS.has(entry.name.toLowerCase());
        await visit(path.join(dir, entry.name), depth + 1, childNonCanonical);
        if (bestScore === 0) return;
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        const extPriority = ICON_EXT_PRIORITY[ext];
        if (extPriority === undefined) continue;
        const stem = entry.name
          .slice(0, entry.name.length - ext.length - 1)
          .toLowerCase();
        const basePriority = ICON_BASE_PRIORITY[stem];
        if (basePriority === undefined) continue;
        // Depth penalty so top-level files beat deeply nested ones at the
        // same base/ext rank, but a `favicon.svg` 4 levels deep still wins
        // over a `logo.png` at the root. Non-canonical paths (examples/,
        // tests/, fixtures/) take a large penalty so the brand favicon
        // outranks starter-template icons.
        const score =
          basePriority * 100 +
          extPriority * 10 +
          depth +
          (nonCanonical ? 500 : 0);
        if (score < bestScore) {
          bestScore = score;
          bestPath = path.join(dir, entry.name);
          if (bestScore === 0) return;
        }
      }
    }
  }

  await visit(repoPath, 0, false);
  if (!bestPath) return undefined;
  try {
    const buf = await fs.readFile(bestPath);
    if (buf.byteLength === 0 || buf.byteLength > 256 * 1024) return undefined;
    const ext = path.extname(bestPath).slice(1).toLowerCase();
    const mime =
      ext === "svg"
        ? "image/svg+xml"
        : ext === "png"
          ? "image/png"
          : ext === "ico"
            ? "image/x-icon"
            : `image/${ext}`;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

// Maps each SSH `Host` alias in ~/.ssh/config to its real `HostName`, so a
// remote like `git@github.com-work:owner/repo` (a common per-account alias) can
// be recognized as GitHub. Read once and cached for the process lifetime.
let sshHostMapCache: Map<string, string> | null = null;
async function sshHostMap(): Promise<Map<string, string>> {
  if (sshHostMapCache) return sshHostMapCache;
  const map = new Map<string, string>();
  try {
    const cfg = await fs.readFile(
      path.join(os.homedir(), ".ssh", "config"),
      "utf8",
    );
    let aliases: string[] = [];
    for (const raw of cfg.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const sep = line.search(/\s|=/);
      if (sep === -1) continue;
      const key = line.slice(0, sep).toLowerCase();
      const value = line
        .slice(sep + 1)
        .replace(/^[=\s]+/, "")
        .trim();
      if (key === "host") aliases = value.split(/\s+/);
      else if (key === "hostname") for (const a of aliases) map.set(a, value);
    }
  } catch {
    // No ssh config (or unreadable) — nothing to resolve.
  }
  sshHostMapCache = map;
  return map;
}

// Recognizes GitHub remotes across https, scp-like ssh (git@host:owner/repo)
// and ssh:// forms. SSH host aliases are resolved via ~/.ssh/config, and the
// repo segment may contain dots (e.g. "repo.js").
async function parseGithubFromUrl(
  url: string,
): Promise<{ owner: string; repo: string } | undefined> {
  let host: string | undefined;
  let rest: string | undefined;
  if (!url.includes("://")) {
    const m = url.match(/^[^@]+@([^:/]+):(.+)$/); // git@host:owner/repo
    if (m) {
      host = m[1];
      rest = m[2];
    }
  }
  if (!host) {
    // scheme://[user@]host[:port]/owner/repo
    const m = url.match(
      /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/]+)(?::\d+)?\/(.+)$/i,
    );
    if (m) {
      host = m[1];
      rest = m[2];
    }
  }
  if (!host || !rest) return undefined;

  let realHost = host;
  if (realHost.toLowerCase() !== "github.com") {
    realHost = (await sshHostMap()).get(host) ?? host;
  }
  if (realHost.toLowerCase() !== "github.com") return undefined;

  const m = rest
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .match(/^([^/]+)\/([^/]+)$/);
  if (!m) return undefined;
  return { owner: m[1], repo: m[2] };
}

export async function buildRepoInfo(repoPath: string): Promise<RepoInfo> {
  const git = simpleGit(repoPath);
  const id = repoIdFromPath(repoPath);
  const name = path.basename(repoPath);
  let remoteUrl: string | undefined;
  let githubOwner: string | undefined;
  let githubRepo: string | undefined;
  let defaultBranch: string | undefined;
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
    if (origin?.refs.fetch) {
      remoteUrl = origin.refs.fetch;
      const gh = await parseGithubFromUrl(remoteUrl);
      if (gh) {
        githubOwner = gh.owner;
        githubRepo = gh.repo;
      }
      console.log(
        `[repo] buildRepoInfo "${name}" remote=${origin.name} url=${remoteUrl} ` +
          `→ parsed ${gh ? `${gh.owner}/${gh.repo}` : "(not a github.com URL)"}`,
      );
    } else {
      console.log(
        `[repo] buildRepoInfo "${name}" has no usable remote ` +
          `(remotes: ${remotes.map((r) => r.name).join(", ") || "none"})`,
      );
    }
  } catch (err) {
    console.error(
      `[repo] buildRepoInfo "${name}" failed to read remotes:`,
      err,
    );
  }
  try {
    const head = await git.raw([
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    defaultBranch = head.trim().replace(/^origin\//, "");
  } catch {
    // ignore
  }
  const iconDataUrl = await findRepoIcon(repoPath);
  return {
    id,
    path: path.resolve(repoPath),
    name,
    iconDataUrl,
    remoteUrl,
    githubOwner,
    githubRepo,
    defaultBranch,
    lastOpenedAt: Date.now(),
  };
}

export async function listBranches(repoPath: string): Promise<BranchInfo[]> {
  const git = simpleGit(repoPath);
  // One `for-each-ref` call gives us the name, ref kind, and committer epoch
  // for every branch — much cheaper than `branch -vv` + per-branch date probes
  // and lets the picker show GitHub Desktop-style relative timestamps.
  const [currentRaw, raw] = await Promise.all([
    git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
    git.raw([
      "for-each-ref",
      "--format=%(refname:short)\t%(committerdate:unix)\t%(upstream:short)",
      "refs/heads",
    ]),
  ]);
  const current = currentRaw.trim();
  const branches: BranchInfo[] = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const [name, tsRaw, upstreamRaw] = line.split("\t");
    if (!name) continue;
    const ts = Number(tsRaw);
    branches.push({
      name,
      current: name === current,
      // `%(upstream:short)` is the configured tracking branch (e.g.
      // "origin/feat") — its presence is how we tell a branch also lives on a
      // remote. Empty when the branch tracks nothing.
      upstream: upstreamRaw ? upstreamRaw : undefined,
      isRemote: false,
      lastCommitAt: Number.isFinite(ts) && ts > 0 ? ts * 1000 : undefined,
    });
  }
  branches.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
    // Most recently updated first — matches GitHub Desktop's branch list.
    const at = a.lastCommitAt ?? 0;
    const bt = b.lastCommitAt ?? 0;
    if (at !== bt) return bt - at;
    return a.name.localeCompare(b.name);
  });
  return branches;
}

export async function getCurrentBranch(
  repoPath: string,
): Promise<string | null> {
  const git = simpleGit(repoPath);
  try {
    const status = await git.status();
    return status.current ?? null;
  } catch {
    return null;
  }
}

export async function checkout(
  repoPath: string,
  branch: string,
): Promise<void> {
  const git = simpleGit(repoPath);
  await git.checkout(branch);
}

export async function isWorkingTreeDirty(repoPath: string): Promise<boolean> {
  try {
    const status = await simpleGit(repoPath).status();
    return !status.isClean();
  } catch {
    return false;
  }
}

export interface CreateBranchResult {
  ok: boolean;
  error?: string;
}

export interface DeleteBranchResult {
  ok: boolean;
  error?: string;
}

// Create a new branch off of `base` (defaults to current HEAD). When
// `checkout` is true we use `checkout -b` so the working tree follows along
// (GitHub Desktop's "Bring my changes" path); otherwise the branch is created
// without switching, leaving uncommitted changes on the current branch.
export async function createBranch(
  repoPath: string,
  name: string,
  opts: { base?: string; checkout: boolean },
): Promise<CreateBranchResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Branch name is required." };
  const git = simpleGit(repoPath);
  try {
    if (opts.checkout) {
      const args = ["checkout", "-b", trimmed];
      if (opts.base) args.push(opts.base);
      await git.raw(args);
    } else {
      const args = ["branch", trimmed];
      if (opts.base) args.push(opts.base);
      await git.raw(args);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Delete a local branch (force, so we don't fail on "not fully merged" — the
// UI already gates this behind an explicit confirmation). When `deleteRemote`
// is set and the branch has a tracking ref, also delete it on the remote.
// `upstream` is the short tracking ref (e.g. "origin/feat"); we split off the
// remote name (which can't contain a slash) to get the remote-side ref.
export async function deleteBranch(
  repoPath: string,
  name: string,
  opts: { deleteRemote: boolean; upstream?: string },
): Promise<DeleteBranchResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Branch name is required." };
  const git = simpleGit(repoPath);
  try {
    await git.raw(["branch", "-D", trimmed]);
    if (opts.deleteRemote && opts.upstream) {
      const slash = opts.upstream.indexOf("/");
      if (slash > 0) {
        const remote = opts.upstream.slice(0, slash);
        const ref = opts.upstream.slice(slash + 1);
        await git.push([remote, "--delete", ref]);
      }
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function mapStatus(x: string, y: string): FileStatus {
  const c = (x + y).trim();
  if (c.includes("?")) return "untracked";
  if (x === "R" || y === "R") return "renamed";
  if (x === "C" || y === "C") return "copied";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  if (x === "T" || y === "T") return "type-change";
  return "modified";
}

async function refsForContext(
  git: SimpleGit,
  ctx: DiffContext,
): Promise<{ base?: string; head?: string; workingTree: boolean }> {
  switch (ctx.kind) {
    case "workingTree":
      return { workingTree: true };
    case "branch":
      return { base: ctx.base, head: ctx.head, workingTree: false };
    case "pr":
      return {
        base: `pr/${ctx.prNumber}/base`,
        head: `pr/${ctx.prNumber}/head`,
        workingTree: false,
      };
    case "session":
      // Sessions are frozen snapshots served from disk by the IPC layer; they
      // never reach git-service. Guard the invariant rather than guess a ref.
      throw new Error("session context is not backed by git");
  }
  void git;
}

export async function listChangedFiles(
  repoPath: string,
  ctx: DiffContext,
): Promise<ChangedFile[]> {
  const git = simpleGit(repoPath);
  const refs = await refsForContext(git, ctx);
  const files: ChangedFile[] = [];

  if (refs.workingTree) {
    // One git status + one git diff --numstat HEAD covers every tracked
    // change (staged + unstaged). Calling numstat per-file was the dominant
    // cost: each git subprocess spawn is ~30-100ms on macOS, so a repo with
    // 30 changed files paid 1-3s just for numstats. Untracked files aren't
    // included in `diff HEAD`; we count those from disk in parallel below.
    const [status, numstatRaw] = await Promise.all([
      git.status(),
      git.raw(["diff", "--numstat", "HEAD"]).catch(() => ""),
    ]);
    const numstatMap = parseNumstat(numstatRaw);
    const untrackedReadTasks: Array<{ index: number; filePath: string }> = [];

    for (const f of status.files) {
      const fullStatus = mapStatus(f.index, f.working_dir);
      let oldPath: string | undefined;
      let p = f.path;
      const renameMatch = f.path.match(/^(.+) -> (.+)$/);
      if (renameMatch) {
        oldPath = renameMatch[1];
        p = renameMatch[2];
      }
      const ns = numstatMap.get(p) ?? {
        additions: 0,
        deletions: 0,
        binary: false,
      };
      files.push({
        path: p,
        oldPath,
        status: fullStatus,
        additions: ns.additions,
        deletions: ns.deletions,
        isBinary: ns.binary,
      });
      // numstat returns nothing for untracked files (git doesn't track them)
      // and sometimes for staged adds depending on what's in the index.
      // Queue a disk read so the user sees a real line count.
      if (
        !ns.binary &&
        ns.additions === 0 &&
        ns.deletions === 0 &&
        (fullStatus === "untracked" || fullStatus === "added")
      ) {
        untrackedReadTasks.push({ index: files.length - 1, filePath: p });
      }
    }

    if (untrackedReadTasks.length > 0) {
      await Promise.all(
        untrackedReadTasks.map(async ({ index, filePath }) => {
          const counted = await countWorkingLines(repoPath, filePath);
          if (counted) {
            files[index] = {
              ...files[index],
              additions: counted.additions,
              isBinary: counted.binary,
            };
          }
        }),
      );
    }
    return files;
  }

  if (refs.base && refs.head) {
    const raw = await git.raw([
      "diff",
      "--name-status",
      "--find-renames",
      `${refs.base}...${refs.head}`,
    ]);
    const numstatRaw = await git.raw([
      "diff",
      "--numstat",
      `${refs.base}...${refs.head}`,
    ]);
    const numstatMap = parseNumstat(numstatRaw);

    for (const line of raw.split("\n").filter(Boolean)) {
      const parts = line.split("\t");
      const code = parts[0];
      let status: FileStatus = "modified";
      let oldPath: string | undefined;
      let p = parts[1];
      if (code.startsWith("A")) status = "added";
      else if (code.startsWith("D")) status = "deleted";
      else if (code.startsWith("M")) status = "modified";
      else if (code.startsWith("R")) {
        status = "renamed";
        oldPath = parts[1];
        p = parts[2];
      } else if (code.startsWith("C")) {
        status = "copied";
        oldPath = parts[1];
        p = parts[2];
      } else if (code.startsWith("T")) status = "type-change";
      const ns = numstatMap.get(p) ?? {
        additions: 0,
        deletions: 0,
        binary: false,
      };
      files.push({
        path: p,
        oldPath,
        status,
        additions: ns.additions,
        deletions: ns.deletions,
        isBinary: ns.binary,
      });
    }
  }
  return files;
}

interface NumstatRow {
  additions: number;
  deletions: number;
  binary: boolean;
}

function parseNumstat(raw: string): Map<string, NumstatRow> {
  const map = new Map<string, NumstatRow>();
  for (const line of raw.split("\n").filter(Boolean)) {
    const [a, d, ...pathParts] = line.split("\t");
    const p = pathParts.join("\t");
    const binary = a === "-" && d === "-";
    map.set(p, {
      additions: binary ? 0 : Number(a) || 0,
      deletions: binary ? 0 : Number(d) || 0,
      binary,
    });
  }
  return map;
}

async function safeNumstat(
  git: SimpleGit,
  base: string | undefined,
  head: string | undefined,
  filePath: string,
): Promise<NumstatRow> {
  try {
    const args: string[] = ["diff", "--numstat"];
    if (base && head) args.push(`${base}...${head}`);
    args.push("--", filePath);
    const raw = await git.raw(args);
    const row = parseNumstat(raw).get(filePath);
    return row ?? { additions: 0, deletions: 0, binary: false };
  } catch {
    return { additions: 0, deletions: 0, binary: false };
  }
}

// Raw newline count of a working-copy file, plus a quick null-byte probe to
// flag binaries. Used as a fallback when git numstat can't produce a count
// (untracked files, fresh adds).
async function countWorkingLines(
  repoPath: string,
  filePath: string,
): Promise<{ additions: number; binary: boolean } | null> {
  try {
    const abs = path.join(repoPath, filePath);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return null;
    if (stat.size === 0) return { additions: 0, binary: false };
    if (stat.size > MAX_FILE_BYTES) return { additions: 0, binary: false };
    const buf = await fs.readFile(abs);
    const probeEnd = Math.min(buf.length, 8192);
    for (let i = 0; i < probeEnd; i++) {
      if (buf[i] === 0) return { additions: 0, binary: true };
    }
    let lines = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) lines++;
    }
    if (buf[buf.length - 1] !== 0x0a) lines++;
    return { additions: lines, binary: false };
  } catch {
    return null;
  }
}

async function showFile(
  git: SimpleGit,
  ref: string,
  filePath: string,
): Promise<string> {
  try {
    return await git.show([`${ref}:${filePath}`]);
  } catch {
    return "";
  }
}

async function readWorkingFile(
  repoPath: string,
  filePath: string,
): Promise<string> {
  try {
    const buf = await fs.readFile(path.join(repoPath, filePath));
    if (buf.byteLength > MAX_FILE_BYTES) return "";
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

export async function getDiff(
  repoPath: string,
  filePath: string,
  ctx: DiffContext,
): Promise<DiffData> {
  const git = simpleGit(repoPath);
  const refs = await refsForContext(git, ctx);

  let patch = "";
  let oldContents = "";
  let newContents = "";
  let isBinary = false;
  let additions = 0;
  let deletions = 0;
  let status: FileStatus = "modified";
  let oldPath: string | undefined;

  if (refs.workingTree) {
    patch = await git.diff(["HEAD", "--", filePath]).catch(() => "");
    if (!patch) {
      patch = await git.diff(["--", filePath]).catch(() => "");
    }
    oldContents = await showFile(git, "HEAD", filePath);
    newContents = await readWorkingFile(repoPath, filePath);
    const ns = await safeNumstat(git, undefined, undefined, filePath);
    additions = ns.additions;
    deletions = ns.deletions;
    isBinary = ns.binary;
  } else if (refs.base && refs.head) {
    patch = await git
      .raw(["diff", `${refs.base}...${refs.head}`, "--", filePath])
      .catch(() => "");
    oldContents = await showFile(git, refs.base, filePath);
    newContents = await showFile(git, refs.head, filePath);
    const ns = await safeNumstat(git, refs.base, refs.head, filePath);
    additions = ns.additions;
    deletions = ns.deletions;
    isBinary = ns.binary;
  }

  if (newContents && !oldContents) status = "added";
  else if (oldContents && !newContents) status = "deleted";
  else status = "modified";

  const truncated =
    oldContents.length > MAX_FILE_BYTES || newContents.length > MAX_FILE_BYTES;

  return {
    file: {
      path: filePath,
      oldPath,
      status,
      additions,
      deletions,
      isBinary,
    },
    patch,
    oldContents: truncated ? "" : oldContents,
    newContents: truncated ? "" : newContents,
    truncated,
  };
}

export interface PushStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  hasRemote: boolean;
  aheadOfDefault: number;
  pushRemote?: string;
}

async function countAheadOfDefault(
  git: SimpleGit,
  branch: string,
  defaultBranch: string | undefined,
): Promise<number> {
  if (!defaultBranch || branch === defaultBranch) return 0;
  try {
    const out = (
      await git.raw(["rev-list", "--count", `${defaultBranch}..HEAD`])
    ).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

export async function getPushStatus(
  repoPath: string,
  defaultBranch?: string,
): Promise<PushStatus> {
  const git = simpleGit(repoPath);
  let branch: string | null = null;
  try {
    branch =
      (await git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() ||
      null;
  } catch {
    branch = null;
  }
  const remotes = await git.getRemotes(true).catch(() => []);
  const hasRemote = remotes.some((r) => r.name === "origin");
  const aheadOfDefault = branch
    ? await countAheadOfDefault(git, branch, defaultBranch)
    : 0;
  if (!branch || !hasRemote) {
    return {
      branch,
      ahead: 0,
      behind: 0,
      hasUpstream: false,
      hasRemote,
      aheadOfDefault,
    };
  }
  let upstream: string | null = null;
  try {
    upstream = (
      await git.raw([
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ])
    ).trim();
  } catch {
    upstream = null;
  }
  if (!upstream) {
    return {
      branch,
      ahead: 0,
      behind: 0,
      hasUpstream: false,
      hasRemote,
      aheadOfDefault,
    };
  }
  let ahead = 0;
  let behind = 0;
  try {
    const counts = (
      await git.raw([
        "rev-list",
        "--left-right",
        "--count",
        `${upstream}...HEAD`,
      ])
    ).trim();
    const [b, a] = counts.split(/\s+/).map((n) => Number(n) || 0);
    behind = b;
    ahead = a;
  } catch {
    // ignore
  }
  let pushRemote: string | undefined;
  try {
    pushRemote =
      (await git.raw(["config", "--get", `branch.${branch}.remote`])).trim() ||
      undefined;
  } catch {
    pushRemote = undefined;
  }
  return {
    branch,
    ahead,
    behind,
    hasUpstream: true,
    hasRemote,
    aheadOfDefault,
    pushRemote,
  };
}

export interface PullPushResult {
  ok: boolean;
  conflicts: string[];
  error?: string;
}

async function listUnmergedPaths(git: SimpleGit): Promise<string[]> {
  try {
    const raw = await git.raw(["diff", "--name-only", "--diff-filter=U"]);
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function pull(repoPath: string): Promise<PullPushResult> {
  const git = simpleGit(repoPath);
  try {
    await git.raw(["pull", "--no-rebase", "--no-edit"]);
    return { ok: true, conflicts: [] };
  } catch (err) {
    const conflicts = await listUnmergedPaths(git);
    if (conflicts.length > 0) return { ok: false, conflicts };
    return {
      ok: false,
      conflicts: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function push(repoPath: string): Promise<PullPushResult> {
  const git = simpleGit(repoPath);
  try {
    const status = await getPushStatus(repoPath);
    if (!status.branch) throw new Error("Not on a branch (detached HEAD).");
    if (!status.hasRemote) throw new Error("No 'origin' remote configured.");
    const args = ["push"];
    if (!status.hasUpstream)
      args.push("--set-upstream", "origin", status.branch);
    await git.raw(args);
    return { ok: true, conflicts: [] };
  } catch (err) {
    return {
      ok: false,
      conflicts: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getConflicts(repoPath: string): Promise<string[]> {
  return listUnmergedPaths(simpleGit(repoPath));
}

export async function stageFile(
  repoPath: string,
  filePath: string,
): Promise<void> {
  await simpleGit(repoPath).add([filePath]);
}

// Whether `relPath` exists in the current HEAD commit. False for new/untracked
// files and for repos with no commits yet (`HEAD:<path>` can't be resolved).
async function pathExistsInHead(
  git: SimpleGit,
  relPath: string,
): Promise<boolean> {
  try {
    await git.raw(["cat-file", "-e", `HEAD:${relPath}`]);
    return true;
  } catch {
    return false;
  }
}

// Discard a file's working-tree (and staged) changes, mirroring GitHub
// Desktop's "Discard Changes". Tracked files are reset to their HEAD state
// (recoverable from history); files with no HEAD version — new or untracked —
// are moved to the OS trash so the discard stays recoverable. `oldPath` is the
// pre-rename path: a rename also leaves the original deleted from the worktree,
// so we restore it too.
export async function discardChanges(
  repoPath: string,
  filePath: string,
  oldPath?: string,
): Promise<void> {
  const git = simpleGit(repoPath);
  const restoreOrTrash = async (relPath: string): Promise<void> => {
    const inHead = await pathExistsInHead(git, relPath);
    // Unstage first so the worktree restore (or trash) isn't left partial.
    await git.raw(["reset", "-q", "HEAD", "--", relPath]).catch(() => {});
    if (inHead) {
      await git.raw(["checkout", "HEAD", "--", relPath]);
    } else {
      // Lazy-import electron so this module stays importable from the plain-node
      // CLI (which captures sessions but never discards files).
      const { shell } = await import("electron");
      await shell.trashItem(path.join(repoPath, relPath)).catch(() => {});
    }
  };
  await restoreOrTrash(filePath);
  if (oldPath && oldPath !== filePath) await restoreOrTrash(oldPath);
}

// Try to wrap up an in-progress merge. If unmerged paths remain we surface
// them; otherwise we create the merge commit.
export async function continueMerge(repoPath: string): Promise<PullPushResult> {
  const git = simpleGit(repoPath);
  const remaining = await listUnmergedPaths(git);
  if (remaining.length > 0) return { ok: false, conflicts: remaining };
  try {
    await git.raw(["commit", "--no-edit"]);
    return { ok: true, conflicts: [] };
  } catch (err) {
    return {
      ok: false,
      conflicts: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function abortMerge(repoPath: string): Promise<void> {
  await simpleGit(repoPath)
    .raw(["merge", "--abort"])
    .catch(() => {});
}

export interface CommitResult {
  ok: boolean;
  error?: string;
}

// Stages and commits exactly the given pathspecs. The renderer decides which
// changed files are checked for inclusion; `paths` is that selection (with the
// old path included for renames so both sides of the rename are staged).
export async function commit(
  repoPath: string,
  message: string,
  paths: string[],
  identity?: GitIdentity | null,
): Promise<CommitResult> {
  const git = simpleGit(repoPath);
  try {
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Commit message is required.");
    if (paths.length === 0) throw new Error("No files selected to commit.");
    // Stage only the selected paths (handles adds, edits, and deletions).
    await git.raw(["add", "-A", "--", ...paths]);
    // `-c` sets config for this invocation only, overriding both author and
    // committer without touching the repo's git config.
    const identityArgs = identity
      ? [
          "-c",
          `user.name=${identity.name}`,
          "-c",
          `user.email=${identity.email}`,
        ]
      : [];
    // Pin the commit to the selected pathspecs so anything else that may be
    // staged in the index is left out — only the checked files are committed.
    await git.raw([...identityArgs, "commit", "-m", trimmed, "--", ...paths]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface LastCommit {
  hash: string;
  subject: string;
  // Relative time string straight from git (e.g. "2 minutes ago").
  relativeTime: string;
  // True when the commit has not yet been pushed to any remote, so undoing it
  // is safe (won't rewrite shared history).
  canUndo: boolean;
}

// Returns the tip commit of HEAD plus whether it is safe to undo. `null` when
// the branch has no commits yet.
export async function getLastCommit(
  repoPath: string,
): Promise<LastCommit | null> {
  const git = simpleGit(repoPath);
  try {
    const raw = (
      await git.raw(["log", "-1", "--pretty=format:%H%x1f%s%x1f%cr"])
    ).trim();
    if (!raw) return null;
    const [hash, subject, relativeTime] = raw.split("");
    // Count commits reachable from HEAD but not from any remote-tracking
    // branch. >0 means the tip is local-only and can be undone. With no remotes
    // at all this counts every commit, which is the behavior we want.
    let canUndo = true;
    try {
      const unpushed =
        Number(
          (
            await git.raw(["rev-list", "--count", "HEAD", "--not", "--remotes"])
          ).trim(),
        ) || 0;
      canUndo = unpushed > 0;
    } catch {
      canUndo = true;
    }
    return { hash, subject, relativeTime, canUndo };
  } catch {
    return null;
  }
}

// Undoes the last commit while keeping its changes staged in the index, the
// same way GitHub Desktop's "Undo" affordance works (git reset --soft HEAD~1).
// When the tip is the repo's only commit, drop the HEAD ref instead so the
// index is preserved.
export async function undoLastCommit(repoPath: string): Promise<CommitResult> {
  const git = simpleGit(repoPath);
  try {
    const count =
      Number((await git.raw(["rev-list", "--count", "HEAD"])).trim()) || 0;
    if (count <= 0) throw new Error("No commit to undo.");
    if (count === 1) {
      await git.raw(["update-ref", "-d", "HEAD"]);
    } else {
      await git.raw(["reset", "--soft", "HEAD~1"]);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface CloneResult {
  ok: boolean;
  path?: string;
  error?: string;
}

// Clones the given URL into `parentDir/<repo-name>`. Caller is responsible for
// validating the parent dir exists and is writable.
export async function cloneRepo(
  url: string,
  parentDir: string,
): Promise<CloneResult> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: "Repository URL is required." };
  const name = trimmed
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .pop();
  if (!name)
    return { ok: false, error: "Could not parse repository name from URL." };
  const target = path.join(parentDir, name);
  try {
    const exists = await fs
      .stat(target)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return { ok: false, error: `Destination already exists: ${target}` };
    }
    await simpleGit().clone(trimmed, target);
    return { ok: true, path: target };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Initialize a fresh git repository at `targetDir`. If the directory is
// already a git repo we leave it alone and return success — picking an
// existing repo via "Create new" should still register it instead of erroring.
export async function initRepo(
  targetDir: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const stat = await fs.stat(targetDir).catch(() => null);
    if (!stat) {
      await fs.mkdir(targetDir, { recursive: true });
    } else if (!stat.isDirectory()) {
      return { ok: false, error: `Not a directory: ${targetDir}` };
    }
    if (await isGitRepo(targetDir)) return { ok: true };
    await simpleGit(targetDir).init();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchOrigin(
  repoPath: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const git = simpleGit(repoPath);
    await git.fetch(["origin", "--prune"]);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function fetchPRRef(
  repoPath: string,
  prNumber: number,
): Promise<{ headRef: string; baseRef: string }> {
  const git = simpleGit(repoPath);
  await git
    .fetch(["origin", `pull/${prNumber}/head:refs/pr/${prNumber}/head`])
    .catch(() => {});
  // base ref is whatever the PR base branch's tip is — we fetch and pin locally
  // The actual base branch name comes from the GitHub API and is resolved by the caller.
  return {
    headRef: `pr/${prNumber}/head`,
    baseRef: `pr/${prNumber}/base`,
  };
}

// Check out the branch a PR was opened from so it can be reviewed locally. If
// a local branch with the PR's head name already exists (the common case for
export interface CheckoutPROptions {
  prNumber: number;
  // The PR head branch name; also used as the local branch name so a plain
  // `git push` (push.default=simple) targets the matching remote branch.
  headRef: string;
  // Clone URL + owner of the repo the head branch lives in (the push target).
  // Undefined when the head repo was deleted — we then fall back to a
  // read-only snapshot with no push tracking.
  headRepoUrl?: string;
  headRepoOwner?: string;
  // The fork's own remote URL, so we can reuse "origin" instead of adding a
  // duplicate remote when the head repo is the fork itself.
  originUrl?: string;
  // Remote (name or URL) to read the PR head snapshot from in the fallback
  // path, when the head repo is unknown.
  fallbackRemote?: string;
}

// Check out the branch a PR was opened from so it can be reviewed — and so
// commits can be pushed back to it. We point a remote at the PR's head repo
// (reusing "origin" or any existing remote already aimed there, otherwise
// adding one named after the head owner), fetch the head branch, and create a
// local branch that tracks it. Tracking is what makes the commit box show
// "View PR"/"Push" instead of "Publish", and routes `git push` to the PR's
// branch (which fails cleanly when you lack write access).
//
// When the head repo is unknown (deleted fork), we fall back to fetching a
// read-only `pull/<n>/head` snapshot with no tracking.
export async function checkoutPR(
  repoPath: string,
  opts: CheckoutPROptions,
): Promise<void> {
  const git = simpleGit(repoPath);
  const { prNumber, headRef, headRepoUrl, headRepoOwner } = opts;

  if (!headRepoUrl || !headRepoOwner) {
    const local = await git.branchLocal();
    if (!local.all.includes(headRef)) {
      await git.fetch([
        opts.fallbackRemote ?? "origin",
        `pull/${prNumber}/head:${headRef}`,
      ]);
    }
    await git.checkout(headRef);
    return;
  }

  const remote = await ensureRemoteForUrl(
    git,
    headRepoOwner,
    headRepoUrl,
    opts.originUrl,
  );
  await git.fetch([remote, headRef]);

  const local = await git.branchLocal();
  if (local.all.includes(headRef)) {
    await git.checkout(headRef);
    // Re-point tracking in case this branch previously tracked elsewhere.
    await git
      .raw(["branch", `--set-upstream-to=${remote}/${headRef}`, headRef])
      .catch(() => {});
  } else {
    await git.checkout(["-b", headRef, "--track", `${remote}/${headRef}`]);
  }
}

// True when two remote URLs point at the same github.com owner/repo, ignoring
// protocol (SSH vs HTTPS) and a trailing ".git".
async function sameGithubRepo(a: string, b: string): Promise<boolean> {
  const ga = await parseGithubFromUrl(a);
  const gb = await parseGithubFromUrl(b);
  return (
    !!ga &&
    !!gb &&
    ga.owner.toLowerCase() === gb.owner.toLowerCase() &&
    ga.repo.toLowerCase() === gb.repo.toLowerCase()
  );
}

function sanitizeRemoteName(owner: string): string {
  return owner.replace(/[^A-Za-z0-9._-]/g, "-") || "fork";
}

// Resolve a remote name pointing at `url`, reusing "origin" or any existing
// remote already aimed at that repo; otherwise add one named after `owner`.
async function ensureRemoteForUrl(
  git: SimpleGit,
  owner: string,
  url: string,
  originUrl?: string,
): Promise<string> {
  if (originUrl && (await sameGithubRepo(originUrl, url))) return "origin";
  const remotes = await git.getRemotes(true).catch(() => []);
  for (const r of remotes) {
    if (r.refs.fetch && (await sameGithubRepo(r.refs.fetch, url)))
      return r.name;
  }
  let name = sanitizeRemoteName(owner);
  // The preferred name is taken by a remote pointing elsewhere (none matched
  // the URL above) — don't clobber it (e.g. "origin"); use a PR-scoped name.
  if (remotes.some((r) => r.name === name)) name = `pr-${name}`;
  if (remotes.some((r) => r.name === name)) {
    await git.remote(["set-url", name, url]);
  } else {
    await git.addRemote(name, url);
  }
  return name;
}

export async function pinPRBaseRef(
  repoPath: string,
  prNumber: number,
  baseBranch: string,
): Promise<void> {
  const git = simpleGit(repoPath);
  await git.fetch(["origin", baseBranch]).catch(() => {});
  // Create or update a ref that points at origin/<baseBranch>'s current tip
  const sha = await git.revparse([`origin/${baseBranch}`]).catch(() => "");
  if (sha) {
    await git
      .raw(["update-ref", `refs/pr/${prNumber}/base`, sha.trim()])
      .catch(() => {});
  }
}
