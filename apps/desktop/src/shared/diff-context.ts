import type { DiffContext } from './types.js';

export function diffContextKey(ctx: DiffContext): string {
	switch (ctx.kind) {
		case 'workingTree':
			return 'workingTree';
		case 'branch':
			return `branch:${ctx.base}..${ctx.head}`;
		case 'pr':
			return `pr:${ctx.prNumber}`;
		case 'session':
			return `session:${ctx.sessionId}`;
		case 'slice':
			return `slice:${ctx.sliceId}`;
		case 'union':
			return `union:${ctx.base}..${ctx.head ?? 'HEAD'}`;
		case 'stash':
			return `stash:${ctx.ref}`;
	}
}
