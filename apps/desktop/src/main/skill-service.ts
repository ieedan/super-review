import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SkillStatus } from '@shared/types.js';
import {
	bundledSkillDir,
	bundledSkillVersion,
	parseSkillVersion,
	SUPER_REVIEW_SKILL_DIR,
	SUPER_REVIEW_SKILL_FILE
} from './super-review-skill.js';

// The install/update state of the super-review skill in `repoPath`. Presence of
// `.agents/skills/super-review/SKILL.md` is what makes the skill discoverable to
// an agent, so that file existing is the whole "installed" test. When it's there
// we compare its `metadata.version` against the bundled skill to decide whether
// to offer an update — an older or un-versioned copy is out of date.
export async function getSkillStatus(repoPath: string): Promise<SkillStatus> {
	let source: string;
	try {
		source = await fs.readFile(path.join(repoPath, SUPER_REVIEW_SKILL_FILE), 'utf8');
	} catch {
		return { installed: false, updateAvailable: false };
	}
	const bundled = await bundledSkillVersion();
	const installed = parseSkillVersion(source);
	// Offer an update only when we ship a versioned skill that's newer than the
	// installed copy, treating an un-versioned (null) install as the oldest.
	const updateAvailable = bundled !== null && (installed === null || installed < bundled);
	return { installed: true, updateAvailable };
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
