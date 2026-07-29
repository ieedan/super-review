import type { CommitMessageModelOption } from '@super-review/core/types';

export interface OpenCodeModelEntry {
	/** Full slug, i.e. what gets written to prefs and passed to the CLI. */
	id: string;
	/** First slug segment: the authenticated provider the model is billed through. */
	provider: string;
	/** Everything after the provider, so `openrouter/google/lyria-3` -> `google/lyria-3`. */
	name: string;
}

export interface OpenCodeModelGroup {
	provider: string;
	models: OpenCodeModelEntry[];
}

// OpenCode slugs are `<provider>/<model>`, and a routing provider adds the lab in
// the middle: `openrouter/google/lyria-3-clip-preview`. Only the first segment is
// the provider; everything after it names the model.
export function splitOpenCodeSlug(id: string): OpenCodeModelEntry {
	const slash = id.indexOf('/');
	if (slash <= 0 || slash === id.length - 1) return { id, provider: '', name: id };
	return { id, provider: id.slice(0, slash), name: id.slice(slash + 1) };
}

/**
 * Group a flat model list by provider, keeping the incoming order both between
 * groups and inside them. The list arrives ranked cheapest-first, so a provider
 * sorts by its best model and the first entry overall stays the first entry
 * shown. Models without a provider segment land in a trailing unnamed group.
 */
export function groupOpenCodeModels(models: CommitMessageModelOption[]): OpenCodeModelGroup[] {
	const groups = new Map<string, OpenCodeModelGroup>();
	for (const model of models) {
		const entry = splitOpenCodeSlug(model.id);
		const existing = groups.get(entry.provider);
		if (existing) {
			existing.models.push(entry);
			continue;
		}
		groups.set(entry.provider, { provider: entry.provider, models: [entry] });
	}
	const ordered = [...groups.values()];
	// A provider-less group is a parse fallback, not a real provider; keep it last.
	return [...ordered.filter((g) => g.provider), ...ordered.filter((g) => !g.provider)];
}
