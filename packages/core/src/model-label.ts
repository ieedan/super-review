const CLAUDE_FAMILIES = new Set(['fable', 'mythos', 'opus', 'sonnet', 'haiku']);

// `claude-haiku-4-5-20251001` -> `Haiku 4.5`. Returns null for anything that
// isn't a Claude model id, so callers can fall back to their own label.
export function formatClaudeModelLabel(id: string): string | null {
	// Trailing `[1m]` marks the long-context variant, not a different model.
	const parts = id
		.trim()
		.replace(/\[[^\]]*\]$/, '')
		.split('-');
	if (parts.shift() !== 'claude') return null;

	const family = parts.shift();
	if (!family || !CLAUDE_FAMILIES.has(family)) return null;

	// Dated snapshots (`-20251001`) name the same model as the bare alias.
	if (parts.length > 1 && /^\d{8}$/.test(parts[parts.length - 1]!)) parts.pop();
	if (parts.length === 0 || !parts.every((part) => /^\d+$/.test(part))) return null;

	return `${family[0]!.toUpperCase()}${family.slice(1)} ${parts.join('.')}`;
}
