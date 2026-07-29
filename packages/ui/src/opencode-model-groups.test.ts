import { describe, expect, it } from 'vitest';
import { groupOpenCodeModels, splitOpenCodeSlug } from './opencode-model-groups.js';

const model = (id: string) => ({ id, label: id });

describe('splitOpenCodeSlug', () => {
	it('splits provider from model', () => {
		expect(splitOpenCodeSlug('opencode/deepseek-v4-flash-free')).toEqual({
			id: 'opencode/deepseek-v4-flash-free',
			provider: 'opencode',
			name: 'deepseek-v4-flash-free'
		});
	});

	it('keeps the lab segment with the model name', () => {
		expect(splitOpenCodeSlug('openrouter/google/lyria-3-clip-preview')).toEqual({
			id: 'openrouter/google/lyria-3-clip-preview',
			provider: 'openrouter',
			name: 'google/lyria-3-clip-preview'
		});
	});

	it('leaves a slug without a provider segment ungrouped', () => {
		expect(splitOpenCodeSlug('grok-code')).toEqual({
			id: 'grok-code',
			provider: '',
			name: 'grok-code'
		});
		expect(splitOpenCodeSlug('/leading').provider).toBe('');
		expect(splitOpenCodeSlug('trailing/').provider).toBe('');
	});
});

describe('groupOpenCodeModels', () => {
	it('groups by provider and keeps the incoming order', () => {
		const groups = groupOpenCodeModels([
			model('opencode/deepseek-v4-flash-free'),
			model('openrouter/google/lyria-3-clip-preview'),
			model('opencode/big-pickle'),
			model('anthropic/claude-haiku-4-5')
		]);

		expect(groups.map((g) => g.provider)).toEqual(['opencode', 'openrouter', 'anthropic']);
		expect(groups[0]?.models.map((m) => m.name)).toEqual(['deepseek-v4-flash-free', 'big-pickle']);
		expect(groups[1]?.models.map((m) => m.name)).toEqual(['google/lyria-3-clip-preview']);
	});

	it('sorts a provider-less group last', () => {
		const groups = groupOpenCodeModels([model('grok-code'), model('opencode/big-pickle')]);
		expect(groups.map((g) => g.provider)).toEqual(['opencode', '']);
	});

	it('returns nothing for an empty list', () => {
		expect(groupOpenCodeModels([])).toEqual([]);
	});
});
