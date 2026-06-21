import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
	bundledSkillDir,
	SUPER_REVIEW_SKILL_DIR,
	SUPER_REVIEW_SKILL_FILE
} from './super-review-skill.js';

// Whether the super-review skill is installed in `repoPath` — i.e. the repo
// has a `.agents/skills/super-review/SKILL.md`. Its presence is what makes
// the skill discoverable to an agent, so that file existing is the whole test.
export async function isSkillInstalled(repoPath: string): Promise<boolean> {
	try {
		await fs.access(path.join(repoPath, SUPER_REVIEW_SKILL_FILE));
		return true;
	} catch {
		return false;
	}
}

// Copy the bundled super-review skill into the repo. We replace the existing
// `.agents/skills/super-review` directory wholesale (rather than writing a
// single SKILL.md) so re-installing upgrades a stale copy *and* prunes any files
// dropped from newer versions of the skill, and so the skill can grow to more
// than one file without changing this code.
export async function installSkill(repoPath: string): Promise<void> {
	const dest = path.join(repoPath, SUPER_REVIEW_SKILL_DIR);
	await fs.rm(dest, { recursive: true, force: true });
	await fs.mkdir(path.dirname(dest), { recursive: true });
	await fs.cp(bundledSkillDir(), dest, { recursive: true });
}
