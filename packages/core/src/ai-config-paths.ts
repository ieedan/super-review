// The single source of truth for WHERE the super-review skill and tour-author
// subagent get installed, and which coding agents the `.agents/` convention
// covers.
//
// Most agents read the shared `.agents/` convention (skills at `.agents/skills`,
// subagents at `.agents/agents`), so a single `.agents/` write covers all of
// them. Claude Code is the exception: it reads `.claude/skills` and
// `.claude/agents` exclusively, so it gets its own target. Any future agent that
// doesn't adopt `.agents/` would be added here as another target.
//
// This file is Node-free: paths are stored as POSIX segments and resolved in the
// main process against the repo root (project) or `os.homedir()` (global).
//
// Sources:
// - The `.agents/` convention (agentskills.io) is read by Cursor, Codex,
//   opencode, and GitHub Copilot:
//     Cursor — cursor.com/docs/skills (.agents/skills, ~/.agents/skills)
//     Codex — developers.openai.com/codex/skills (.agents/skills, ~/.agents/skills)
//     opencode — opencode.ai/docs/skills (.agents/skills, ~/.agents/skills)
//     Copilot — docs.github.com Copilot add-skills (.agents/skills, ~/.agents/skills)
// - Claude Code reads only its own dirs — code.claude.com/docs/en/skills,
//   /en/sub-agents (.claude/skills + ~/.claude/skills, .claude/agents + ~/.claude/agents)

import type { HarnessKind, TargetKind } from './types.js';

// The skill lives in a directory of this name (contains SKILL.md + supporting
// files); the subagent is a single markdown file based on this name.
export const SKILL_DIR_NAME = 'super-review';
export const SUBAGENT_NAME = 'super-review-tour-author';

// The files that make up the bundled skill, for the dialog's file-tree preview
// (the renderer can't read the filesystem). Keep in sync with
// `.agents/skills/super-review/`.
export const SKILL_FILES = ['SKILL.md', 'document-session.md', 'review-comments.md'];

// The agents folded into the shared `.agents` target. Drives both the collage
// icon on the `.agents` row and its hover-card, so the user can see exactly which
// agents selecting `.agents` covers.
export const AGENTS_CONVENTION_HARNESSES: HarnessKind[] = ['cursor', 'codex', 'opencode', 'copilot'];

const AGENT_MD = `${SUBAGENT_NAME}.md`;

export interface ArtifactLocation {
	// Path relative to the repo root (project scope).
	project: string;
	// Path relative to the user home dir (global scope), or null when the agent
	// has no global/user location for this artifact.
	global: string | null;
}

export interface TargetPaths {
	// Human label for the dialog row.
	label: string;
	// The super-review skill DIRECTORY, or undefined when the target has no skill
	// location of its own (Codex reads the skill from `.agents`).
	skill?: ArtifactLocation;
	// The tour-author subagent FILE, or undefined when the target has no subagent
	// location of its own.
	subagent?: ArtifactLocation;
	// How the subagent file is written: a copy of the bundled markdown, or
	// converted to Codex's TOML schema (see subagent-convert.ts).
	subagentFormat: 'markdown' | 'toml';
	// A directory under the user home whose presence signals the agent is
	// installed (used to badge a "detected" target). null for `standard` (the
	// shared convention, always available).
	detectDir: string | null;
}

export const HARNESS_AI_PATHS: Record<TargetKind, TargetPaths> = {
	// The shared convention, read by Cursor, Codex, opencode, and Copilot.
	standard: {
		label: '.agents',
		skill: {
			project: `.agents/skills/${SKILL_DIR_NAME}`,
			global: `.agents/skills/${SKILL_DIR_NAME}`
		},
		subagent: { project: `.agents/agents/${AGENT_MD}`, global: `.agents/agents/${AGENT_MD}` },
		subagentFormat: 'markdown',
		detectDir: null
	},
	// Claude Code does not read `.agents/` — it needs its own directories.
	'claude-code': {
		label: 'Claude Code',
		skill: {
			project: `.claude/skills/${SKILL_DIR_NAME}`,
			global: `.claude/skills/${SKILL_DIR_NAME}`
		},
		subagent: { project: `.claude/agents/${AGENT_MD}`, global: `.claude/agents/${AGENT_MD}` },
		subagentFormat: 'markdown',
		detectDir: '.claude'
	},
	// Codex reads its skill from `.agents/skills` (covered by `standard`), but its
	// custom agents use a TOML file under `.codex/agents`, so it carries only a
	// subagent location and is offered separately when a subagent is selected.
	codex: {
		label: 'Codex',
		subagent: { project: `.codex/agents/${SUBAGENT_NAME}.toml`, global: `.codex/agents/${SUBAGENT_NAME}.toml` },
		subagentFormat: 'toml',
		detectDir: '.codex'
	}
};

// Stable display order for the dialog's agent step. Codex sits at the end and is
// only shown when a subagent is selected.
export const AI_CONFIG_TARGETS: TargetKind[] = ['standard', 'claude-code', 'codex'];
