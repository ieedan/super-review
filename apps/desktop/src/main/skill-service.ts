import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
	DOCUMENT_SESSION_SKILL,
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

// Write the bundled document-session skill into the repo, creating the
// `.agents/skills/document-session` directory as needed. Overwrites an existing
// SKILL.md so re-installing also upgrades a stale copy to the current version.
export async function installSkill(repoPath: string): Promise<void> {
	const dir = path.join(repoPath, DOCUMENT_SESSION_SKILL_DIR);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, 'SKILL.md'), DOCUMENT_SESSION_SKILL, 'utf8');
}
