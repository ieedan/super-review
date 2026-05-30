import type { DiffContext } from './types.js';

export function diffContextKey(ctx: DiffContext): string {
	switch (ctx.kind) {
		case 'workingTree':
			return 'workingTree';
		case 'branch':
			return `branch:${ctx.base}..${ctx.head}`;
		case 'pr':
			return `pr:${ctx.prNumber}`;
	}
}
