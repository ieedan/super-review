import { describe, expect, it } from 'vitest';
import { scanFile } from './symbol-scan';

// The plain (non-member) occurrences of `name`: what the lens counts.
function refs(source: string, name: string, path = 'a.ts'): number[] {
	const scan = scanFile(source, path);
	if (!scan) throw new Error('unscannable');
	return scan.occurrences.filter((o) => o.name === name && !o.member).map((o) => o.line);
}

function decls(source: string, path = 'a.ts') {
	const scan = scanFile(source, path);
	if (!scan) throw new Error('unscannable');
	return scan.decls.map(
		(d) => `${d.kind} ${d.name}${d.exported ? ' exported' : ''}${d.isDefault ? ' default' : ''}`
	);
}

describe('what is not a reference', () => {
	it('ignores comments, strings, templates and regex literals', () => {
		const src = [
			'function target() {}',
			'// target in a line comment',
			'/* target',
			'   in a block comment */',
			"const a = 'target';",
			'const b = "target";',
			'const c = `target ${1}`;',
			'const d = /target/.test(x);'
		].join('\n');
		expect(refs(src, 'target')).toEqual([]);
	});

	it('counts references inside template interpolations', () => {
		expect(refs('function target() {}\nconst s = `a ${target()} b`;', 'target')).toEqual([2]);
	});

	it('ignores member access but keeps the receiver', () => {
		const src = 'function target() {}\nobj.target();\nobj?.target;\ntarget();';
		expect(refs(src, 'target')).toEqual([4]);
	});

	it('ignores object keys but keeps shorthand and values', () => {
		const src = [
			'function target() {}',
			'const o = { target: 1 };',
			'const p = { target };',
			'const q = { a: target };',
			'const r = {',
			'  target: 2,',
			'  other: 3',
			'};'
		].join('\n');
		expect(refs(src, 'target')).toEqual([3, 4]);
	});

	it('does not read a ternary branch as a key', () => {
		const src =
			'function target() {}\nconst x = cond ? target : other;\nconst y = { k: cond ? target : 1 };';
		expect(refs(src, 'target')).toEqual([2, 3]);
	});

	it('ignores class, enum and interface members', () => {
		const src = [
			'function target() {}',
			'class A {',
			'  target = 1;',
			'  static target2 = target;',
			'  target() {}',
			'  async target3() { return target(); }',
			'}',
			'enum E { target, other }',
			'interface I {',
			'  target: string;',
			'  target(a: number): void;',
			'  field: Map<string, target>;',
			'}'
		].join('\n');
		// Real uses: the static initializer, the call in target3, the generic argument.
		expect(refs(src, 'target')).toEqual([4, 6, 12]);
	});

	it('keeps type references that follow commas in generics', () => {
		const src = [
			'type Foo = { a: string };',
			'interface X {',
			'  m: Map<string, Foo>;',
			'  n: Record<string, Foo<number>>;',
			'}'
		].join('\n');
		expect(refs(src, 'Foo')).toEqual([3, 4]);
	});

	it('does not count import or export specifiers as references', () => {
		const src = [
			"import { target } from './x';",
			"import { other as target2 } from './y';",
			'function target3() {}',
			'export { target3 as target };',
			'target();'
		].join('\n');
		expect(refs(src, 'target')).toEqual([5]);
		expect(refs(src, 'target3')).toEqual([]);
	});
});

describe('shadowing', () => {
	it('records parameters, nested declarations and catch bindings as shadows', () => {
		const src = [
			'function target() {}',
			'function a(target) { return target; }',
			'const b = (x, { target }) => x;',
			'function c() { const target = 1; }',
			'try {} catch (target) {}',
			'items.map(target => target);'
		].join('\n');
		const scan = scanFile(src, 'a.ts')!;
		expect(scan.shadows.has('target')).toBe(true);
	});

	it('does not flag type annotations in parameters as bindings', () => {
		const src = 'type Foo = {};\nfunction f(a: Foo, b: Map<string, Foo>) {}';
		const scan = scanFile(src, 'a.ts')!;
		expect(scan.shadows.has('Foo')).toBe(false);
		expect(refs(src, 'Foo')).toEqual([2, 2]);
	});

	it('treats a top-level declaration as the symbol, not a shadow', () => {
		const scan = scanFile('function target() {}\ntarget();', 'a.ts')!;
		expect(scan.shadows.has('target')).toBe(false);
	});
});

describe('declarations', () => {
	it('finds top-level declarations and their export state', () => {
		const src = [
			'export function a() {}',
			'async function b() {}',
			'export default function c() {}',
			'export class D {}',
			'export interface E {}',
			'export type F = string;',
			'export const G = 1;',
			'const h = () => 1;',
			'export enum I { A }',
			'declare const j: string;',
			'function nested() { function inner() {} const k = 1; }'
		].join('\n');
		expect(decls(src)).toEqual([
			'function a exported',
			'function b',
			'function c default',
			'class D exported',
			'interface E exported',
			'type F exported',
			'const G exported',
			'const h',
			'enum I exported',
			'const j',
			'function nested'
		]);
	});

	it('marks function-like constants', () => {
		const scan = scanFile(
			'const a = () => 1;\nconst b = async (x) => x;\nconst c = 5;\nconst d = function () {};',
			'a.ts'
		)!;
		expect(scan.decls.map((d) => [d.name, d.functionLike])).toEqual([
			['a', true],
			['b', true],
			['c', false],
			['d', true]
		]);
	});

	it('uses the first line of the statement for the lens', () => {
		const scan = scanFile('\n\nexport async function a() {}', 'a.ts')!;
		expect(scan.decls[0].line).toBe(3);
	});

	it('ignores declarations that are not at statement start or top level', () => {
		const src =
			'const x = function inner() {};\nif (a) { function nested() {} }\nlet { p, q } = obj;';
		expect(decls(src)).toEqual(['const x']);
	});

	it('records local export lists', () => {
		const scan = scanFile(
			'function a() {}\nfunction b() {}\nexport { a, b as c };\nexport default a;',
			'a.ts'
		)!;
		expect(scan.localExports.map(({ local, exported }) => ({ local, exported }))).toEqual([
			{ local: 'a', exported: 'a' },
			{ local: 'b', exported: 'c' },
			{ local: 'a', exported: 'default' }
		]);
	});

	it('treats a variable named type as an ordinary identifier', () => {
		const src = 'const type = 1;\nfoo(type);\ntype = 2;';
		expect(refs(src, 'type')).toEqual([2, 3]);
	});
});

describe('imports and re-exports', () => {
	it('parses every import form', () => {
		const src = [
			"import def from './a';",
			"import * as ns from './b';",
			"import { x, y as z, type T } from './c';",
			"import type { U } from './d';",
			"import dflt, { w } from './e';",
			"import './f';"
		].join('\n');
		const scan = scanFile(src, 'a.ts')!;
		expect(scan.imports).toEqual([
			{
				source: './a',
				bindings: [{ kind: 'default', imported: 'default', local: 'def', typeOnly: false }]
			},
			{
				source: './b',
				bindings: [{ kind: 'namespace', imported: '*', local: 'ns', typeOnly: false }]
			},
			{
				source: './c',
				bindings: [
					{ kind: 'named', imported: 'x', local: 'x', typeOnly: false },
					{ kind: 'named', imported: 'y', local: 'z', typeOnly: false },
					{ kind: 'named', imported: 'T', local: 'T', typeOnly: true }
				]
			},
			{ source: './d', bindings: [{ kind: 'named', imported: 'U', local: 'U', typeOnly: true }] },
			{
				source: './e',
				bindings: [
					{ kind: 'default', imported: 'default', local: 'dflt', typeOnly: false },
					{ kind: 'named', imported: 'w', local: 'w', typeOnly: false }
				]
			},
			{ source: './f', bindings: [] }
		]);
	});

	it('parses re-exports', () => {
		const src = [
			"export { a, b as c } from './x';",
			"export * from './y';",
			"export * as ns from './z';"
		].join('\n');
		const scan = scanFile(src, 'a.ts')!;
		expect(
			scan.reexports.map((r) => [
				r.kind,
				r.source,
				r.items.map((i) => `${i.imported}>${i.exported}`)
			])
		).toEqual([
			['named', './x', ['a>a', 'b>c']],
			['star', './y', []],
			['starAs', './z', []]
		]);
	});

	it('records dynamic imports and require', () => {
		const src =
			"const a = await import('./a');\nconst b = require('./b');\nconst c = await import(name);";
		const scan = scanFile(src, 'a.ts')!;
		expect(scan.dynamic).toEqual([
			{ source: './a', via: 'import' },
			{ source: './b', via: 'require' },
			{ source: null, via: 'import' }
		]);
	});

	it('records the property a namespace is accessed by', () => {
		const scan = scanFile("import * as ns from './a';\nns.foo();\nconsole.log(ns);", 'a.ts')!;
		const uses = scan.occurrences.filter((o) => o.name === 'ns');
		expect(uses.map((o) => o.access)).toEqual(['foo', null]);
	});
});

describe('regex versus division', () => {
	it('does not let a division swallow code', () => {
		const src = 'function target() {}\nconst r = (a + b) / 2;\nconst s = a / b / c;\ntarget();';
		expect(refs(src, 'target')).toEqual([4]);
	});
});

describe('svelte', () => {
	const component = [
		'<script lang="ts">',
		"	import Child from './Child.svelte';",
		'	function handle() {}',
		'	const unused = () => 1;',
		'	let { items } = $props();',
		'</script>',
		'',
		'<button onclick={handle}>go</button>',
		'<Child {items} />',
		'{#each items as item}',
		'	<p>{item}</p>',
		'{/each}',
		'<style>',
		'	.handle { color: red; }',
		'</style>'
	].join('\n');

	it('sees template references and component tags', () => {
		expect(refs(component, 'handle', 'C.svelte')).toEqual([8]);
		expect(refs(component, 'Child', 'C.svelte')).toEqual([9]);
		expect(refs(component, 'unused', 'C.svelte')).toEqual([]);
	});

	it('reports the lens line against the whole file', () => {
		const scan = scanFile(component, 'C.svelte')!;
		const handle = scan.decls.find((d) => d.name === 'handle')!;
		expect(handle.line).toBe(3);
		expect(handle.svelteInstance).toBe(true);
	});

	it('treats each-items and snippet params as shadows', () => {
		const src = [
			'<script>',
			'	function item() {}',
			'	function row() {}',
			'</script>',
			'{#each list as item}{item}{/each}',
			'{#snippet row(x)}{x}{/snippet}'
		].join('\n');
		const scan = scanFile(src, 'C.svelte')!;
		expect(scan.shadows.has('item')).toBe(true);
		expect(scan.shadows.has('row')).toBe(true);
	});

	it('counts directive functions and shorthand bindings', () => {
		const src = [
			'<script>',
			'	function action() {}',
			'	let value = 1;',
			'</script>',
			'<input use:action bind:value />'
		].join('\n');
		expect(refs(src, 'action', 'C.svelte')).toEqual([5]);
		expect(refs(src, 'value', 'C.svelte')).toEqual([5]);
	});

	it('reads a dotted component tag as a property access on its namespace', () => {
		const src = [
			'<script>',
			"	import * as Ui from './ui';",
			'</script>',
			'<Ui.Root><Ui.Item.Label /></Ui.Root>'
		].join('\n');
		const scan = scanFile(src, 'C.svelte')!;
		const uses = scan.occurrences.filter((o) => o.name === 'Ui' && !o.member);
		expect(uses.map((o) => o.access)).toEqual(['Root', 'Item']);
		expect(scan.occurrences.filter((o) => o.member).map((o) => `${o.obj}.${o.name}`)).toEqual([
			'Ui.Root',
			'Ui.Item',
			'Item.Label'
		]);
	});

	it('is not thrown off by a closing block before a slash', () => {
		const src = [
			'<script>',
			'	function target() {}',
			'</script>',
			'{#if a}x{/if} <a href="/x">y</a> {target()}'
		].join('\n');
		expect(refs(src, 'target', 'C.svelte')).toEqual([4]);
	});
});
