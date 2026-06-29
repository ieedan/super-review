import { describe, expect, it } from 'vitest';
import { toCodexToml } from '@super-review/core/subagent-convert';

describe('toCodexToml', () => {
	const markdown = [
		'---',
		'name: super-review-tour-author',
		'description: Documents changes as a guided tour.',
		'model: inherit',
		'---',
		'',
		'You are a code-tour author.',
		'',
		'Do the thing.'
	].join('\n');

	it('maps frontmatter name/description and the body to developer_instructions', () => {
		const toml = toCodexToml(markdown);
		expect(toml).toContain('name = "super-review-tour-author"');
		expect(toml).toContain('description = "Documents changes as a guided tour."');
		expect(toml).toContain('developer_instructions = """');
		expect(toml).toContain('You are a code-tour author.');
		expect(toml).toContain('Do the thing.');
		expect(toml).not.toContain('model: inherit');
		expect(toml).not.toMatch(/^---/m);
	});

	it('strips wrapping quotes from frontmatter values', () => {
		const quoted = [
			'---',
			'name: "quoted-name"',
			"description: 'single quoted'",
			'---',
			'Body'
		].join('\n');
		const toml = toCodexToml(quoted);
		expect(toml).toContain('name = "quoted-name"');
		expect(toml).toContain('description = "single quoted"');
	});

	it('escapes characters that would break the TOML strings', () => {
		const tricky = [
			'---',
			'name: agent',
			'description: has "quotes" and a \\ backslash',
			'---',
			'Body with """ triple quotes and a \\ slash'
		].join('\n');
		const toml = toCodexToml(tricky);
		expect(toml).toContain('description = "has \\"quotes\\" and a \\\\ backslash"');
		expect(toml).toContain('\\"\\"\\"');
		expect(toml.endsWith('"""\n')).toBe(true);
	});

	it('falls back to the default name when frontmatter is missing', () => {
		const toml = toCodexToml('Just a body, no frontmatter.');
		expect(toml).toContain('name = "super-review-tour-author"');
		expect(toml).toContain('description = ""');
		expect(toml).toContain('Just a body, no frontmatter.');
	});
});
