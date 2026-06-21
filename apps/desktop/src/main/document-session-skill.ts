// The `document-session` skill that the "Install skill" action drops into a
// review repo. The skill's *files* are the source of truth: a single copy lives
// at `.agents/skills/document-session/` in this repo (this project dogfooding
// its own skill), and that same directory is bundled into the packaged app via
// electron-builder `extraResources` (see electron-builder.yml). Install copies
// those real files into the target repo — there is no second, inlined copy to
// keep in sync.

import path from 'node:path';
import { app } from 'electron';

// Where the skill lives inside a repo. Agents discover a skill by the presence
// of `<dir>/SKILL.md`, so this path is both what we check for (detection) and
// write (install).
export const DOCUMENT_SESSION_SKILL_DIR = '.agents/skills/document-session';
export const DOCUMENT_SESSION_SKILL_FILE = `${DOCUMENT_SESSION_SKILL_DIR}/SKILL.md`;

// Absolute path to the bundled skill directory we copy from on install.
//
// - Packaged: electron-builder ships `.agents/skills/document-session` to
//   `<resources>/skills/document-session` (extraResources), unpacked from the
//   asar so it's a real, copyable directory on disk.
// - Dev: `app.getAppPath()` is `apps/desktop`; the canonical skill lives two
//   levels up at the repo root, so we read the dogfooded copy directly.
export function bundledSkillDir(): string {
	return app.isPackaged
		? path.join(process.resourcesPath, 'skills', 'document-session')
		: path.join(app.getAppPath(), '..', '..', DOCUMENT_SESSION_SKILL_DIR);
}
