// The skills that the "Configure AI files" action drops into a review repo. Each
// skill's *files* are the source of truth: a single copy lives at
// `.agents/skills/<name>/` in this repo (this project dogfooding its own skills),
// and each directory is bundled into the packaged app via electron-builder
// `extraResources` (see electron-builder.yml). Install copies those real files
// into the target repo — there is no second, inlined copy to keep in sync.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { SUBAGENT_NAME } from '@super-review/core/ai-config-paths';

// Absolute path to a bundled skill directory we copy from on install.
//
// - Packaged: electron-builder ships `.agents/skills/<name>` to
//   `<resources>/skills/<name>` (extraResources), unpacked from the asar so it's
//   a real, copyable directory on disk.
// - Dev: `app.getAppPath()` is `apps/desktop`; the canonical skills live two
//   levels up at the repo root, so we read the dogfooded copies directly.
export function bundledSkillDir(skillName: string): string {
	return app.isPackaged
		? path.join(process.resourcesPath, 'skills', skillName)
		: path.join(app.getAppPath(), '..', '..', '.agents', 'skills', skillName);
}

// Absolute path to the bundled tour-author subagent markdown we copy from on
// install. Mirrors `bundledSkillDir`:
// - Packaged: electron-builder ships `.agents/agents/super-review-tour-author.md`
//   to `<resources>/agents/super-review-tour-author.md` (extraResources).
// - Dev: read the dogfooded copy at the repo root, two levels up from
//   `apps/desktop`.
export function bundledSubagentFile(): string {
	const fileName = `${SUBAGENT_NAME}.md`;
	return app.isPackaged
		? path.join(process.resourcesPath, 'agents', fileName)
		: path.join(app.getAppPath(), '..', '..', '.agents', 'agents', fileName);
}

// Parse the skill's version from its SKILL.md frontmatter `metadata.version`.
// The skill ships a monotonically increasing integer that we bump whenever its
// files change; the app compares an installed copy's version against the bundled
// one to decide whether to offer an update. Returns null when there's no version
// — an un-versioned skill (predating versioning), which we treat as out of date.
export function parseSkillVersion(skillMd: string): number | null {
	// Only look inside the leading `---` frontmatter fence.
	const frontmatter = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!frontmatter) return null;
	// The frontmatter is small and hand-written, so a line scan for the single
	// `version:` key beats pulling in a YAML parser.
	const version = frontmatter[1].match(/^\s*version:\s*["']?(\d+)["']?\s*$/m);
	if (!version) return null;
	const parsed = Number.parseInt(version[1], 10);
	return Number.isNaN(parsed) ? null : parsed;
}

// The version of a skill we ship and would install, read from its bundled
// SKILL.md so it always matches what the skill install writes. null if the
// bundled skill somehow has no version — in which case we never prompt an update.
export async function bundledSkillVersion(skillName: string): Promise<number | null> {
	try {
		const src = await fs.readFile(path.join(bundledSkillDir(skillName), 'SKILL.md'), 'utf8');
		return parseSkillVersion(src);
	} catch {
		return null;
	}
}
