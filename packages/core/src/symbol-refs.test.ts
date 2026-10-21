import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import { computeSymbolRefs, getFileSymbolRefs } from './symbol-refs.js';
import type { FileSymbolRefs, SymbolLens } from './types.js';

// A small monorepo shaped like this one: a workspace package reached through an
// exports map, a tsconfig path alias, a barrel, and Svelte importers. Every
// file is written for one assertion; the comments say which.
const FILES: Record<string, string> = {
	'package.json': JSON.stringify({ name: 'root', private: true }),
	'packages/lib/package.json': JSON.stringify({
		name: '@acme/lib',
		exports: { '.': './src/index.ts', './*': './src/*' }
	}),
	'packages/lib/src/index.ts':
		"export * from './format';\nexport { used as renamedUsed } from './helpers';\n",
	'packages/lib/src/format.ts': [
		'export function formatDate(d: Date): string {',
		'	return d.toISOString();',
		'}',
		'',
		'export function neverCalled(): void {}',
		'',
		'export const MAX = 5;',
		'',
		'export interface Options {',
		'	name: string;',
		'}',
		'',
		'function localOnly() {}',
		'function unusedLocal() {}',
		'localOnly();',
		''
	].join('\n'),
	'packages/lib/src/helpers.ts':
		'export function used() {}\nexport function alsoUsed() {}\nexport function dead() {}\n',
	'packages/lib/src/unrelated.ts': 'export function formatDate(x: number) { return String(x); }\n',

	// Imports through the package root (barrel -> star re-export) and uses it twice.
	'apps/a/src/viaBarrel.ts':
		"import { formatDate } from '@acme/lib';\nformatDate(new Date());\nformatDate(new Date());\n",
	// Imports through the exports wildcard, renames it, and uses the local name.
	'apps/a/src/viaWildcard.ts':
		"import { formatDate as fmt, type Options } from '@acme/lib/format';\nconst o: Options = { name: 'x' };\nfmt(new Date());\n",
	// Namespace import: one access by name, which counts for that export only.
	'apps/a/src/viaNamespace.ts': "import * as fmt from '@acme/lib/format';\nfmt.MAX;\n",
	// Same name from a different module: must not count.
	'apps/a/src/other.ts': "import { formatDate } from '@acme/lib/unrelated';\nformatDate(1);\n",
	// Mentions the name without importing it: must not count.
	'apps/a/src/mention.ts':
		"// formatDate neverCalled\nconst s = 'formatDate';\nconst o = { formatDate: 1 };\n",
	// A local binding named like the export, in a file that also imports it.
	'apps/a/src/shadow.ts':
		"import { MAX } from '@acme/lib/format';\nfunction f(MAX: number) { return MAX; }\nconsole.log(MAX);\n",
	// Alias via tsconfig paths.
	'apps/a/tsconfig.json':
		'{\n  // comments are fine\n  "compilerOptions": { "paths": { "@lib/*": ["../../packages/lib/src/*",], }, },\n}\n',
	'apps/a/src/viaAlias.ts': "import { alsoUsed } from '@lib/helpers';\nalsoUsed();\n",
	// Relative import, plus a Svelte component using it in its template.
	'apps/a/src/Widget.svelte': [
		'<script lang="ts">',
		"	import { used } from '../../../packages/lib/src/helpers';",
		'</script>',
		'<button onclick={used}>go</button>'
	].join('\n'),
	// `import { x } from './leaf'; export { x }` is a re-export through a local
	// binding; the import in useLeaf.ts then reaches `leaf` by way of mid.ts.
	'packages/lib/src/leaf.ts': 'export function leaf() {}\nexport function orphan() {}\n',
	'packages/lib/src/mid.ts': "import { leaf } from './leaf';\nexport { leaf };\n",
	'apps/a/src/useLeaf.ts': "import { leaf } from '@acme/lib/mid';\nleaf();\n",
	// Consumed by SvelteKit by file name and export name, never imported.
	'apps/a/src/routes/+page.ts': 'export const load = () => 1;\nfunction helper() {}\n',
	// A published package's entry has consumers we can't see.
	'packages/pub/package.json': JSON.stringify({ name: 'pub', main: 'src/index.ts' }),
	'packages/pub/src/index.ts': 'export function api() {}\n',
	// Generated code gets no lenses.
	'apps/a/src/_generated/api.ts': 'export const api = 1;\n',
	// shadcn-style namespace: a barrel imported as `* as Filters` and used both as
	// `Filters.Filter` in script and as `<Filters.Root>` in a template.
	'packages/lib/src/ui/types.ts':
		'export type Filter = { id: string };\nexport type Unused = number;\n',
	'packages/lib/src/ui/root.svelte': '<div></div>\n',
	'packages/lib/src/ui/index.ts':
		"export type { Filter, Unused } from './types';\nimport Root from './root.svelte';\nexport { Root };\n",
	'apps/a/src/Page.svelte': [
		'<script lang="ts">',
		"	import * as Filters from '../../../packages/lib/src/ui';",
		'	let f: Filters.Filter = { id: "a" };',
		'</script>',
		'<Filters.Root>{f.id}</Filters.Root>'
	].join('\n'),
	// A dynamic import we can follow only as "somewhere".
	'packages/lib/src/lazymod.ts': 'export function lazyThing() {}\n',
	'apps/a/src/lazy.ts': "export const load = () => import('../../../packages/lib/src/lazymod');\n"
};

let root: string;
let repo: string;

beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-symbol-refs-'));
	repo = path.join(root, 'repo');
	await fs.mkdir(repo);
	const git = simpleGit(repo);
	await git.init(['-b', 'main']);
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');
	for (const [file, content] of Object.entries(FILES)) {
		await fs.mkdir(path.dirname(path.join(repo, file)), { recursive: true });
		await fs.writeFile(path.join(repo, file), content);
	}
	await git.add('.');
	await git.commit('init');
});

afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

function lens(result: FileSymbolRefs, name: string): SymbolLens {
	const found = result.symbols.find((s) => s.name === name);
	if (!found)
		throw new Error(`no lens for ${name}: ${result.symbols.map((s) => s.name).join(', ')}`);
	return found;
}

describe('computeSymbolRefs', () => {
	it('counts only references reached through an import of the file', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/format.ts');
		expect(r.supported).toBe(true);

		// viaBarrel (2) + viaWildcard via alias `fmt` (1); `unrelated.ts`'s own
		// formatDate and the textual mentions must not count.
		const fd = lens(r, 'formatDate');
		expect(fd.locations.map((l) => `${l.path}:${l.line}`).sort()).toEqual([
			'apps/a/src/viaBarrel.ts:2',
			'apps/a/src/viaBarrel.ts:3',
			'apps/a/src/viaWildcard.ts:3'
		]);
		expect(fd.count).toBe(3);
	});

	it('reports 0 for an export nobody uses, never for one that is used', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/format.ts');
		expect(lens(r, 'neverCalled').count).toBe(0);
		expect(lens(r, 'Options').count).toBe(1);
	});

	it('counts a namespace access for that export only', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/format.ts');
		expect(lens(r, 'MAX').locations.some((l) => l.path === 'apps/a/src/viaNamespace.ts')).toBe(
			true
		);
		expect(
			lens(r, 'formatDate').locations.some((l) => l.path === 'apps/a/src/viaNamespace.ts')
		).toBe(false);
	});

	it('marks a count approximate when the name is also bound in a using file', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/format.ts');
		const max = lens(r, 'MAX');
		expect(max.confidence).toBe('approximate');
		expect(lens(r, 'Options').confidence).not.toBe('approximate');
	});

	it('flags a dynamic import of the module as unknown, not unused', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/lazymod.ts');
		const lazy = lens(r, 'lazyThing');
		expect(lazy.count).toBe(0);
		expect(lazy.confidence).toBe('atLeast');
	});

	it('is exact about an unused export when every importer was followed', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/format.ts');
		expect(lens(r, 'neverCalled').confidence).toBe('exact');
	});

	it('counts same-file uses of a non-exported function', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/format.ts');
		expect(lens(r, 'localOnly').count).toBe(1);
		expect(lens(r, 'unusedLocal').count).toBe(0);
	});

	it('follows tsconfig aliases, relative imports and Svelte templates', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/helpers.ts');
		const used = lens(r, 'used');
		// Svelte template use, plus the barrel's `export { used as renamedUsed }`.
		expect(used.locations.map((l) => l.path).sort()).toEqual([
			'apps/a/src/Widget.svelte',
			'packages/lib/src/index.ts'
		]);
		expect(lens(r, 'alsoUsed').locations.map((l) => l.path)).toEqual(['apps/a/src/viaAlias.ts']);
		expect(lens(r, 'dead').count).toBe(0);
		expect(lens(r, 'dead').confidence).toBe('exact');
	});

	it('includes untracked files in the working tree and a preview of each use', async () => {
		const added = path.join(repo, 'apps/a/src/untracked.ts');
		await fs.writeFile(
			added,
			"import { dead } from '../../../packages/lib/src/helpers';\n  dead();\n"
		);
		try {
			const r = await computeSymbolRefs(
				repo,
				{ kind: 'workingTree' },
				'packages/lib/src/helpers.ts'
			);
			const dead = lens(r, 'dead');
			expect(dead.count).toBe(1);
			expect(dead.locations[0]).toMatchObject({
				path: 'apps/a/src/untracked.ts',
				line: 2,
				text: 'dead();'
			});
		} finally {
			await fs.rm(added);
		}
	});

	it('reads a committed ref instead of the working tree', async () => {
		const added = path.join(repo, 'apps/a/src/dirty.ts');
		await fs.writeFile(
			added,
			"import { dead } from '../../../packages/lib/src/helpers';\ndead();\n"
		);
		try {
			const head = await computeSymbolRefs(
				repo,
				{ kind: 'ref', ref: 'HEAD' },
				'packages/lib/src/helpers.ts'
			);
			expect(lens(head, 'dead').count).toBe(0);
			const wt = await computeSymbolRefs(
				repo,
				{ kind: 'workingTree' },
				'packages/lib/src/helpers.ts'
			);
			expect(lens(wt, 'dead').count).toBe(1);
		} finally {
			await fs.rm(added);
		}
	});

	it('reports the line the lens belongs above and the line count it was computed for', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/helpers.ts');
		expect(r.lineCount).toBe(3);
		expect(lens(r, 'dead').line).toBe(3);
	});

	it('counts a re-export through a local binding and follows it to the real users', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/lib/src/leaf.ts');
		const leaf = lens(r, 'leaf');
		expect(leaf.locations.map((l) => l.path).sort()).toEqual([
			'apps/a/src/useLeaf.ts',
			'packages/lib/src/mid.ts'
		]);
		expect(lens(r, 'orphan').count).toBe(0);
		expect(lens(r, 'orphan').confidence).toBe('exact');
	});

	it('never calls a convention-consumed export unused', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'apps/a/src/routes/+page.ts');
		const load = lens(r, 'load');
		expect(load.count).toBe(0);
		expect(load.confidence).toBe('atLeast');
		expect(load.uncertainty).toMatch(/convention/);
		// A non-exported helper in the same file is still just unused.
		expect(lens(r, 'helper').confidence).toBe('exact');
	});

	it('treats a published package entry as having outside consumers', async () => {
		const r = await computeSymbolRefs(repo, { kind: 'workingTree' }, 'packages/pub/src/index.ts');
		expect(lens(r, 'api')).toMatchObject({ count: 0, confidence: 'atLeast' });
		expect(lens(r, 'api').uncertainty).toMatch(/published/);
	});

	it('gives generated files no lenses', async () => {
		const r = await computeSymbolRefs(
			repo,
			{ kind: 'workingTree' },
			'apps/a/src/_generated/api.ts'
		);
		expect(r.supported).toBe(false);
	});

	it('follows a namespace import used as a Svelte component tag', async () => {
		const r = await computeSymbolRefs(
			repo,
			{ kind: 'workingTree' },
			'packages/lib/src/ui/types.ts'
		);
		const filter = lens(r, 'Filter');
		// Reached through the barrel: the re-export and `Filters.Filter` in the page.
		expect(filter.confidence).toBe('exact');
		expect(filter.locations.map((l) => l.path).sort()).toEqual([
			'apps/a/src/Page.svelte',
			'packages/lib/src/ui/index.ts'
		]);
		const unused = lens(r, 'Unused');
		expect(unused.confidence).toBe('exact');
		expect(unused.count).toBe(1);
	});

	it('returns nothing for languages it does not scan', async () => {
		const r = await getFileSymbolRefs(repo, { kind: 'workingTree' }, 'package.json');
		expect(r).toEqual({ supported: false, lineCount: 0, symbols: [] });
	});

	it('gives up on contexts that have no readable tree', async () => {
		const r = await getFileSymbolRefs(
			repo,
			{ kind: 'stash', ref: 'abc' },
			'packages/lib/src/helpers.ts'
		);
		expect(r.supported).toBe(false);
	});
});
