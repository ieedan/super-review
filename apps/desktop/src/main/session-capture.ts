import { randomUUID } from "node:crypto";
import { simpleGit } from "simple-git";
import {
  getCurrentBranch,
  getDiff,
  listChangedFiles,
  repoIdFromPath,
} from "./git-service.js";
import type { Session, SessionFile } from "@shared/types.js";

// Metadata supplied by the caller (CLI) when saving a session. Everything but
// the diff itself — the diff is always re-captured from the live working tree.
export interface SessionMeta {
  key?: string;
  name?: string;
  description?: string;
  harness?: Session["harness"];
  harnessLabel?: string;
  harnessUrl?: string;
}

// Capture a frozen snapshot of the repo's current working-tree changes into a
// Session. When `existing` is supplied this is an update: its id/createdAt (and
// any metadata the caller didn't override) are preserved, but the file diffs
// are re-captured fresh so the session reflects the latest cumulative changes.
export async function captureSession(
  repoPath: string,
  meta: SessionMeta,
  existing?: Session | null,
): Promise<Session> {
  const repoId = repoIdFromPath(repoPath);
  const git = simpleGit(repoPath);
  const baseRef = await git.revparse(["HEAD"]).then(
    (sha) => sha.trim(),
    () => undefined,
  );
  const branch =
    (await getCurrentBranch(repoPath).catch(() => null)) ?? undefined;

  const changed = await listChangedFiles(repoPath, { kind: "workingTree" });
  const files: SessionFile[] = [];
  let additions = 0;
  let deletions = 0;
  for (const file of changed) {
    const diff = await getDiff(repoPath, file.path, { kind: "workingTree" });
    files.push({
      path: diff.file.path,
      oldPath: diff.file.oldPath ?? file.oldPath,
      status: diff.file.status,
      additions: diff.file.additions,
      deletions: diff.file.deletions,
      isBinary: diff.file.isBinary,
      patch: diff.patch,
      oldContents: diff.oldContents,
      newContents: diff.newContents,
      truncated: diff.truncated,
    });
    additions += diff.file.additions;
    deletions += diff.file.deletions;
  }

  const now = Date.now();
  return {
    id: existing?.id ?? randomUUID(),
    repoId,
    key: meta.key ?? existing?.key,
    name: meta.name ?? existing?.name ?? "Untitled session",
    description: meta.description ?? existing?.description ?? "",
    harness: meta.harness ?? existing?.harness ?? "other",
    harnessLabel: meta.harnessLabel ?? existing?.harnessLabel,
    harnessUrl: meta.harnessUrl ?? existing?.harnessUrl,
    branch,
    baseRef,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    fileCount: files.length,
    additions,
    deletions,
    files,
  };
}
