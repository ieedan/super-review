import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
	bundledSkillDir,
	DOCUMENT_SESSION_SKILL_DIR,
	DOCUMENT_SESSION_SKILL_FILE
} from './document-session-skill.js';

// Whether the document-session skill is installed in `repoPath` — i.e. the repo
// has a `.agents/skills/document-session/SKILL.md`. Its presence is what makes
// the skill discoverable to an agent, so that file existing is the whole test.
export async function isSkillInstalled(repoPath: string): Promise<boolean> {
	try {
		await fs.access(path.join(repoPath, DOCUMENT_SESSION_SKILL_FILE));
		return true;
	} catch {
		return false;
	}
}

// Copy the bundled document-session skill into the repo. We replace the existing
// `.agents/skills/document-session` directory wholesale (rather than writing a
// single SKILL.md) so re-installing upgrades a stale copy *and* prunes any files
// dropped from newer versions of the skill, and so the skill can grow to more
// than one file without changing this code.
export async function installSkill(repoPath: string): Promise<void> {
	const dest = path.join(repoPath, DOCUMENT_SESSION_SKILL_DIR);
	await fs.rm(dest, { recursive: true, force: true });
	await fs.mkdir(path.dirname(dest), { recursive: true });
	await fs.cp(bundledSkillDir(), dest, { recursive: true });
}
