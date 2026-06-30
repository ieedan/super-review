import { describe, expect, it } from 'vitest';
import {
	AI_CONFIG_TARGETS,
	AGENTS_CONVENTION_HARNESSES,
	BUNDLED_SKILLS,
	HARNESS_AI_PATHS,
	SUBAGENT_NAME
} from '@super-review/core/ai-config-paths';

// Guards the documented install-path matrix (paths verified against each agent's
// official docs). The `.agents` convention covers Cursor/Codex/opencode/Copilot,
// so only `.agents` and Claude Code are real install targets.
describe('HARNESS_AI_PATHS', () => {
	it('has the install targets in display order (Codex last)', () => {
		expect(AI_CONFIG_TARGETS).toEqual(['standard', 'claude-code', 'codex']);
		for (const t of AI_CONFIG_TARGETS) expect(HARNESS_AI_PATHS[t]).toBeDefined();
	});

	it('gives Codex a TOML subagent and no skill of its own (skill rides on .agents)', () => {
		const codex = HARNESS_AI_PATHS.codex;
		expect(codex.skillsBase).toBeUndefined();
		expect(codex.subagentFormat).toBe('toml');
		expect(codex.subagent).toEqual({
			project: `.codex/agents/${SUBAGENT_NAME}.toml`,
			global: `.codex/agents/${SUBAGENT_NAME}.toml`
		});
		expect(codex.detectDir).toBe('.codex');
	});

	it('writes the .agents convention for the shared target (skills base + subagent)', () => {
		const md = `${SUBAGENT_NAME}.md`;
		expect(HARNESS_AI_PATHS.standard.skillsBase).toEqual({
			project: '.agents/skills',
			global: '.agents/skills'
		});
		expect(HARNESS_AI_PATHS.standard.subagent).toEqual({
			project: `.agents/agents/${md}`,
			global: `.agents/agents/${md}`
		});
		// The shared convention is always available (no detect dir).
		expect(HARNESS_AI_PATHS.standard.detectDir).toBeNull();
	});

	it('gives Claude Code its own .claude dirs (it does not read .agents)', () => {
		const md = `${SUBAGENT_NAME}.md`;
		expect(HARNESS_AI_PATHS['claude-code'].skillsBase).toEqual({
			project: '.claude/skills',
			global: '.claude/skills'
		});
		expect(HARNESS_AI_PATHS['claude-code'].subagent).toEqual({
			project: `.claude/agents/${md}`,
			global: `.claude/agents/${md}`
		});
		expect(HARNESS_AI_PATHS['claude-code'].detectDir).toBe('.claude');
	});

	it('lists the agent kinds folded into .agents (collage + hover-card)', () => {
		expect(AGENTS_CONVENTION_HARNESSES).toEqual(['cursor', 'codex', 'opencode', 'copilot']);
	});

	it('bundles the super-review and resolve-comments skills, each with files', () => {
		const names = BUNDLED_SKILLS.map((s) => s.name);
		expect(names).toContain('super-review');
		expect(names).toContain('resolve-comments');
		for (const skill of BUNDLED_SKILLS) {
			expect(skill.files).toContain('SKILL.md');
			expect(skill.files.length).toBeGreaterThan(0);
		}
	});
});
