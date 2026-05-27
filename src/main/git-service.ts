import { simpleGit, type SimpleGit } from 'simple-git';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  BranchInfo,
  ChangedFile,
  DiffContext,
  DiffData,
  FileStatus,
  RepoInfo,
} from '@shared/types.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function repoIdFromPath(p: string): string {
  return createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 12);
}

export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const git = simpleGit(dirPath);
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

async function findRepoIcon(repoPath: string): Promise<string | undefined> {
  const candidates = [
    'favicon.ico',
    'favicon.png',
    'favicon.svg',
    'public/favicon.ico',
    'public/favicon.png',
    'public/favicon.svg',
    'static/favicon.ico',
    'static/favicon.png',
    'static/favicon.svg',
    'src/favicon.ico',
    'src/assets/favicon.ico',
    'apps/web/public/favicon.ico',
    'apps/web/public/favicon.svg',
    'packages/web/public/favicon.ico',
    'web/public/favicon.ico',
    'docs/favicon.ico',
    'icon.png',
    'icon.svg',
    'logo.png',
    'logo.svg',
  ];
  for (const rel of candidates) {
    const abs = path.join(repoPath, rel);
    try {
      const buf = await fs.readFile(abs);
      if (buf.byteLength === 0 || buf.byteLength > 256 * 1024) continue;
      const ext = path.extname(rel).slice(1).toLowerCase();
      const mime =
        ext === 'svg'
          ? 'image/svg+xml'
          : ext === 'png'
            ? 'image/png'
            : ext === 'ico'
              ? 'image/x-icon'
              : `image/${ext}`;
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      // not found, keep looking
    }
  }
  return undefined;
}

function parseGithubFromUrl(url: string): { owner: string; repo: string } | undefined {
  const m =
    url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/) ??
    url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!m) return undefined;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
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
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
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
    const head = await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    defaultBranch = head.trim().replace(/^origin\//, '');
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
  const local = await git.branchLocal();
  const all = await git.branch(['-vv']);
  const branches: BranchInfo[] = [];
  for (const [name, info] of Object.entries(all.branches)) {
    const isRemote = name.startsWith('remotes/');
    const displayName = isRemote ? name.replace(/^remotes\//, '') : name;
    branches.push({
      name: displayName,
      current: name === local.current,
      upstream: undefined,
      isRemote,
    });
    void info;
  }
  branches.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return branches;
}

export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  const git = simpleGit(repoPath);
  try {
    const status = await git.status();
    return status.current ?? null;
  } catch {
    return null;
  }
}

export async function checkout(repoPath: string, branch: string): Promise<void> {
  const git = simpleGit(repoPath);
  await git.checkout(branch);
}

function mapStatus(x: string, y: string): FileStatus {
  const c = (x + y).trim();
  if (c.includes('?')) return 'untracked';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'C' || y === 'C') return 'copied';
  if (x === 'A' || y === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'T' || y === 'T') return 'type-change';
  return 'modified';
}

async function refsForContext(
  git: SimpleGit,
  ctx: DiffContext,
): Promise<{ base?: string; head?: string; workingTree: boolean }> {
  switch (ctx.kind) {
    case 'workingTree':
      return { workingTree: true };
    case 'branch':
      return { base: ctx.base, head: ctx.head, workingTree: false };
    case 'pr':
      return { base: `pr/${ctx.prNumber}/base`, head: `pr/${ctx.prNumber}/head`, workingTree: false };
  }
  void git;
}

export async function listChangedFiles(repoPath: string, ctx: DiffContext): Promise<ChangedFile[]> {
  const git = simpleGit(repoPath);
  const refs = await refsForContext(git, ctx);
  const files: ChangedFile[] = [];

  if (refs.workingTree) {
    const status = await git.status();
    for (const f of status.files) {
      const fullStatus = mapStatus(f.index, f.working_dir);
      let oldPath: string | undefined;
      let p = f.path;
      const renameMatch = f.path.match(/^(.+) -> (.+)$/);
      if (renameMatch) {
        oldPath = renameMatch[1];
        p = renameMatch[2];
      }
      const numstat = await safeNumstat(git, undefined, undefined, p);
      files.push({
        path: p,
        oldPath,
        status: fullStatus,
        additions: numstat.additions,
        deletions: numstat.deletions,
        isBinary: numstat.binary,
      });
    }
    return files;
  }

  if (refs.base && refs.head) {
    const raw = await git.raw([
      'diff',
      '--name-status',
      '--find-renames',
      `${refs.base}...${refs.head}`,
    ]);
    const numstatRaw = await git.raw(['diff', '--numstat', `${refs.base}...${refs.head}`]);
    const numstatMap = parseNumstat(numstatRaw);

    for (const line of raw.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const code = parts[0];
      let status: FileStatus = 'modified';
      let oldPath: string | undefined;
      let p = parts[1];
      if (code.startsWith('A')) status = 'added';
      else if (code.startsWith('D')) status = 'deleted';
      else if (code.startsWith('M')) status = 'modified';
      else if (code.startsWith('R')) {
        status = 'renamed';
        oldPath = parts[1];
        p = parts[2];
      } else if (code.startsWith('C')) {
        status = 'copied';
        oldPath = parts[1];
        p = parts[2];
      } else if (code.startsWith('T')) status = 'type-change';
      const ns = numstatMap.get(p) ?? { additions: 0, deletions: 0, binary: false };
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
  for (const line of raw.split('\n').filter(Boolean)) {
    const [a, d, ...pathParts] = line.split('\t');
    const p = pathParts.join('\t');
    const binary = a === '-' && d === '-';
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
    const args: string[] = ['diff', '--numstat'];
    if (base && head) args.push(`${base}...${head}`);
    args.push('--', filePath);
    const raw = await git.raw(args);
    const row = parseNumstat(raw).get(filePath);
    return row ?? { additions: 0, deletions: 0, binary: false };
  } catch {
    return { additions: 0, deletions: 0, binary: false };
  }
}

async function showFile(git: SimpleGit, ref: string, filePath: string): Promise<string> {
  try {
    return await git.show([`${ref}:${filePath}`]);
  } catch {
    return '';
  }
}

async function readWorkingFile(repoPath: string, filePath: string): Promise<string> {
  try {
    const buf = await fs.readFile(path.join(repoPath, filePath));
    if (buf.byteLength > MAX_FILE_BYTES) return '';
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

export async function getDiff(
  repoPath: string,
  filePath: string,
  ctx: DiffContext,
): Promise<DiffData> {
  const git = simpleGit(repoPath);
  const refs = await refsForContext(git, ctx);

  let patch = '';
  let oldContents = '';
  let newContents = '';
  let isBinary = false;
  let additions = 0;
  let deletions = 0;
  let status: FileStatus = 'modified';
  let oldPath: string | undefined;

  if (refs.workingTree) {
    patch = await git.diff(['HEAD', '--', filePath]).catch(() => '');
    if (!patch) {
      patch = await git.diff(['--', filePath]).catch(() => '');
    }
    oldContents = await showFile(git, 'HEAD', filePath);
    newContents = await readWorkingFile(repoPath, filePath);
    const ns = await safeNumstat(git, undefined, undefined, filePath);
    additions = ns.additions;
    deletions = ns.deletions;
    isBinary = ns.binary;
  } else if (refs.base && refs.head) {
    patch = await git
      .raw(['diff', `${refs.base}...${refs.head}`, '--', filePath])
      .catch(() => '');
    oldContents = await showFile(git, refs.base, filePath);
    newContents = await showFile(git, refs.head, filePath);
    const ns = await safeNumstat(git, refs.base, refs.head, filePath);
    additions = ns.additions;
    deletions = ns.deletions;
    isBinary = ns.binary;
  }

  if (newContents && !oldContents) status = 'added';
  else if (oldContents && !newContents) status = 'deleted';
  else status = 'modified';

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
    oldContents: truncated ? '' : oldContents,
    newContents: truncated ? '' : newContents,
    truncated,
  };
}

export async function fetchPRRef(
  repoPath: string,
  prNumber: number,
): Promise<{ headRef: string; baseRef: string }> {
  const git = simpleGit(repoPath);
  await git.fetch(['origin', `pull/${prNumber}/head:refs/pr/${prNumber}/head`]).catch(() => {});
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
  await git.fetch(['origin', baseBranch]).catch(() => {});
  // Create or update a ref that points at origin/<baseBranch>'s current tip
  const sha = await git.revparse([`origin/${baseBranch}`]).catch(() => '');
  if (sha) {
    await git.raw(['update-ref', `refs/pr/${prNumber}/base`, sha.trim()]).catch(() => {});
  }
}
