// Convert our markdown subagent definition (YAML frontmatter + body) into the
// TOML schema Codex expects for custom agents. Codex reads custom agents from
// `.codex/agents/<name>.toml` with `name`, `description`, and
// `developer_instructions` (the agent's system prompt). Other agents consume the
// markdown file as-is, so this conversion is Codex-only.
// Schema: developers.openai.com/codex/subagents

import { SUBAGENT_NAME } from './ai-config-paths.js';

// Render the markdown subagent as a Codex agent TOML file. Pulls `name` and
// `description` from the frontmatter and maps the markdown body to
// `developer_instructions`.
export function toCodexToml(markdown: string): string {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	const frontmatter = match ? match[1] : '';
	const body = (match ? match[2] : markdown).trim();
	const name = frontmatterValue(frontmatter, 'name') ?? SUBAGENT_NAME;
	const description = frontmatterValue(frontmatter, 'description') ?? '';
	return (
		[
			`name = ${tomlBasicString(name)}`,
			`description = ${tomlBasicString(description)}`,
			`developer_instructions = ${tomlMultilineString(body)}`
		].join('\n') + '\n'
	);
}

// Read a single-line `key: value` from the frontmatter, stripping any wrapping
// quotes. The frontmatter is small and hand-written, so a line scan beats a YAML
// dependency (mirrors parseSkillVersion in super-review-skill.ts).
function frontmatterValue(frontmatter: string, key: string): string | null {
	const match = frontmatter.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm'));
	if (!match) return null;
	return match[1].replace(/^["']|["']$/g, '');
}

// TOML basic (single-line) string: escape backslashes and double quotes.
function tomlBasicString(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// TOML multiline basic string for the agent body. Escape backslashes, and any
// literal `"""` that would otherwise close the string early.
function tomlMultilineString(value: string): string {
	const escaped = value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
	// The newline immediately after the opening delimiter is trimmed by TOML, so
	// the body starts on its own line cleanly.
	return `"""\n${escaped}\n"""`;
}
