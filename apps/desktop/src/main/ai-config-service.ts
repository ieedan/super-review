// Detect and install the super-review skill + tour-author subagent across every
// supported coding agent, at project or global (home) scope. The per-harness
// path table lives in `@super-review/core/ai-config-paths`; this module resolves
// those relative paths against the repo root (project) or the user home dir
// (global), then reads them for detection and writes them on apply.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
	AiArtifact,
	AiArtifactStatus,
	AiConfigApplyRequest,
	AiConfigApplyResult,
	AiConfigInstallItem,
	AiConfigRemoveResult,
	AiConfigStatus,
	AiScope,
	TargetAiStatus
} from '@shared/types.js';
import {
	AI_CONFIG_TARGETS,
	HARNESS_AI_PATHS,
	type ArtifactLocation,
	type TargetPaths
} from '@super-review/core/ai-config-paths';
import { toCodexToml } from '@super-review/core/subagent-convert';
import {
	bundledSkillDir,
	bundledSkillVersion,
	bundledSubagentFile,
	parseSkillVersion
} from './super-review-skill.js';

// Resolve a stored relative path for a scope to an absolute path. Project paths
// are relative to the repo; global paths to the user home (== %USERPROFILE% on
// Windows, so `~/.config/...` becomes `%USERPROFILE%\.config\...`).
function resolveLoc(repoPath: string, scope: AiScope, rel: string): string {
	const base = scope === 'project' ? repoPath : os.homedir();
	return path.join(base, ...rel.split('/'));
}

// Detect a skill directory: installed when its SKILL.md exists; an update is on
// offer when the installed `metadata.version` is behind the bundled skill (an
// un-versioned copy counts as oldest).
async function detectSkill(absDir: string): Promise<AiArtifactStatus> {
	let source: string;
	try {
		source = await fs.readFile(path.join(absDir, 'SKILL.md'), 'utf8');
	} catch {
		return { installed: false, updateAvailable: false, path: absDir };
	}
	const bundled = await bundledSkillVersion();
	const installed = parseSkillVersion(source);
	const updateAvailable = bundled !== null && (installed === null || installed < bundled);
	return { installed: true, updateAvailable, path: absDir };
}

// Detect a subagent file: installed when the file exists; an update is on offer
// when its contents differ from what we would write now (markdown copy, or the
// Codex TOML conversion).
async function detectSubagent(
	absFile: string,
	format: TargetPaths['subagentFormat']
): Promise<AiArtifactStatus> {
	let current: string;
	try {
		current = await fs.readFile(absFile, 'utf8');
	} catch {
		return { installed: false, updateAvailable: false, path: absFile };
	}
	const expected = await renderSubagent(format);
	return { installed: true, updateAvailable: current !== expected, path: absFile };
}

// The subagent contents we would write for a given format, derived from the
// bundled markdown. Cached for the life of a detection/apply pass.
let subagentMarkdownCache: string | null = null;
async function bundledSubagentMarkdown(): Promise<string> {
	if (subagentMarkdownCache === null) {
		subagentMarkdownCache = await fs.readFile(bundledSubagentFile(), 'utf8');
	}
	return subagentMarkdownCache;
}
async function renderSubagent(format: TargetPaths['subagentFormat']): Promise<string> {
	const markdown = await bundledSubagentMarkdown();
	return format === 'toml' ? toCodexToml(markdown) : markdown;
}

// Whether a harness appears installed: its home config dir exists. The shared
// `standard` target has no detect dir and is always available.
async function detectHarnessInstalled(detectDir: string | null): Promise<boolean> {
	if (detectDir === null) return true;
	try {
		await fs.access(path.join(os.homedir(), ...detectDir.split('/')));
		return true;
	} catch {
		return false;
	}
}

// Detect one artifact at both scopes. A null `global` location (e.g. Copilot
// custom agents are repository-only) yields a null global slot.
async function detectArtifact(
	repoPath: string,
	loc: ArtifactLocation,
	detect: (abs: string) => Promise<AiArtifactStatus>
): Promise<{ project: AiArtifactStatus; global: AiArtifactStatus | null }> {
	const project = await detect(resolveLoc(repoPath, 'project', loc.project));
	const global =
		loc.global === null ? null : await detect(resolveLoc(repoPath, 'global', loc.global));
	return { project, global };
}

export async function getAiConfigStatus(repoPath: string): Promise<AiConfigStatus> {
	// Reset the per-pass cache so a skill/subagent edited on disk between calls is
	// re-read.
	subagentMarkdownCache = null;
	const targets: TargetAiStatus[] = [];
	for (const target of AI_CONFIG_TARGETS) {
		const paths = HARNESS_AI_PATHS[target];
		const entry: TargetAiStatus = {
			target,
			harnessDetected: await detectHarnessInstalled(paths.detectDir)
		};
		if (paths.skill) {
			entry.skill = await detectArtifact(repoPath, paths.skill, detectSkill);
		}
		if (paths.subagent) {
			entry.subagent = await detectArtifact(repoPath, paths.subagent, (abs) =>
				detectSubagent(abs, paths.subagentFormat)
			);
		}
		targets.push(entry);
	}
	// Roll up across every artifact/scope so the notices know whether anything is
	// configured or behind, without re-walking the matrix in the renderer.
	const slots = targets.flatMap((t) =>
		[t.skill?.project, t.skill?.global, t.subagent?.project, t.subagent?.global].filter(
			(s): s is AiArtifactStatus => s != null
		)
	);
	return {
		targets,
		anyInstalled: slots.some((s) => s.installed),
		anyUpdateAvailable: slots.some((s) => s.installed && s.updateAvailable)
	};
}

// The resolved destination + subagent format for a single requested item, or an
// error string when the item is invalid (e.g. a global write for an artifact
// with no global location, or a target that doesn't carry that artifact).
function resolveItem(
	repoPath: string,
	item: AiConfigInstallItem
): { dest: string; artifact: AiArtifact; format: TargetPaths['subagentFormat'] } | string {
	const paths = HARNESS_AI_PATHS[item.target];
	const loc = item.artifact === 'skill' ? paths.skill : paths.subagent;
	if (!loc) return `${item.target} has no ${item.artifact} location`;
	const rel = item.scope === 'project' ? loc.project : loc.global;
	if (rel === null) return `${item.target} ${item.artifact} has no global location`;
	return {
		dest: resolveLoc(repoPath, item.scope, rel),
		artifact: item.artifact,
		format: paths.subagentFormat
	};
}

async function writeArtifact(
	dest: string,
	artifact: AiArtifact,
	format: TargetPaths['subagentFormat']
): Promise<void> {
	if (artifact === 'skill') {
		// Replace the skill directory wholesale so re-installing upgrades a stale
		// copy and prunes files dropped from newer versions of the skill.
		await fs.rm(dest, { recursive: true, force: true });
		await fs.mkdir(path.dirname(dest), { recursive: true });
		await fs.cp(bundledSkillDir(), dest, { recursive: true });
	} else {
		await fs.mkdir(path.dirname(dest), { recursive: true });
		await fs.writeFile(dest, await renderSubagent(format), 'utf8');
	}
}

export async function applyAiConfig(
	repoPath: string,
	request: AiConfigApplyRequest
): Promise<AiConfigApplyResult> {
	subagentMarkdownCache = null;
	// Dedupe by resolved path so any two items that map to the same destination are
	// written once and share the outcome (an idempotency guard).
	const byDest = new Map<string, { ok: boolean; error?: string }>();
	const results: AiConfigApplyResult['results'] = [];
	for (const item of request.items) {
		const resolved = resolveItem(repoPath, item);
		if (typeof resolved === 'string') {
			results.push({ item, ok: false, error: resolved });
			continue;
		}
		let outcome = byDest.get(resolved.dest);
		if (!outcome) {
			try {
				await writeArtifact(resolved.dest, resolved.artifact, resolved.format);
				outcome = { ok: true };
			} catch (err) {
				outcome = { ok: false, error: err instanceof Error ? err.message : String(err) };
			}
			byDest.set(resolved.dest, outcome);
		}
		results.push({ item, ...outcome });
	}
	return { results };
}

// Delete one installed skill (directory) or subagent (file). The item resolves
// to a canonical location, so this only ever removes paths we manage. `force`
// makes deleting an already-absent file a no-op rather than an error.
export async function removeAiConfig(
	repoPath: string,
	item: AiConfigInstallItem
): Promise<AiConfigRemoveResult> {
	const resolved = resolveItem(repoPath, item);
	if (typeof resolved === 'string') return { ok: false, error: resolved };
	try {
		await fs.rm(resolved.dest, { recursive: true, force: true });
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
