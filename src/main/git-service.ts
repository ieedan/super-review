import { simpleGit, type SimpleGit } from "simple-git";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  BranchInfo,
  ChangedFile,
  DiffContext,
  DiffData,
  FileStatus,
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

function parseGithubFromUrl(
  url: string,
): { owner: string; repo: string } | undefined {
  const m =
    url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/) ??
    url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!m) return undefined;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
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
      const gh = parseGithubFromUrl(remoteUrl);
      if (gh) {
        githubOwner = gh.owner;
        githubRepo = gh.repo;
      }
    }
  } catch {
    // no remotes
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
      "--format=%(refname:short)\t%(committerdate:unix)",
      "refs/heads",
    ]),
  ]);
  const current = currentRaw.trim();
  const branches: BranchInfo[] = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const [name, tsRaw] = line.split("\t");
    if (!name) continue;
    const ts = Number(tsRaw);
    branches.push({
      name,
      current: name === current,
      upstream: undefined,
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
  return {
    branch,
    ahead,
    behind,
    hasUpstream: true,
    hasRemote,
    aheadOfDefault,
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

// Stages every tracked + untracked change, then commits with the given message.
// Mirrors the "Commit all" affordance of the primary action button.
export async function commitAll(
  repoPath: string,
  message: string,
): Promise<CommitResult> {
  const git = simpleGit(repoPath);
  try {
    await git.raw(["add", "-A"]);
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Commit message is required.");
    await git.raw(["commit", "-m", trimmed]);
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
