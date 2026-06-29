import type { HarnessKind } from '@super-review/core/types';

// Display labels for each harness. The matching logos are bundled inline in
// HarnessLogo.svelte (themed CSS-only); harnesses without a bundled logo fall
// back to a generic agent icon there.
const HARNESS_LABELS: Record<HarnessKind, string> = {
	'claude-code': 'Claude Code',
	cursor: 'Cursor',
	codex: 'Codex',
	opencode: 'OpenCode',
	copilot: 'GitHub Copilot',
	other: 'Agent'
};

export function harnessLabel(harness: HarnessKind, fallback?: string): string {
	if (harness === 'other') return fallback?.trim() || HARNESS_LABELS.other;
	return HARNESS_LABELS[harness];
}
