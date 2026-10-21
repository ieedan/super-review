// "Used in N places" for the top-level declarations of one file.
//
// symbol-scan.ts classifies identifiers within a single file. This module joins
// files: it finds who imports the file (a `git grep` for its module specifier,
// the only search we do), scans those few importers, and counts a use only when
// the importing file reaches the declaration through a real import binding.
// Following imports instead of matching names is what keeps two unrelated
// `formatDate`s from counting each other.
//
// The contract that makes the count safe to act on:
//   * A count of 0 means 0, unless the confidence is `atLeast` (then it means
//     "unknown"). Nothing that might be a use is silently dropped: anything we
//     can't follow (an alias we can't resolve, a dynamic import, a component
//     prop, a script that declares globals) raises `atLeast` instead.
//   * A count above 0 can only be too high when the name is also bound elsewhere
//     in a contributing file (a parameter, a nested declaration), which is
//     reported as `approximate`.

import path from 'node:path';
import {
	grepSnapshotFiles,
	listSnapshotFiles,
	readSnapshotFile,
	resolveContextSnapshot,
	type RepoSnapshot
} from './git-service.js';
import {
	isScannablePath,
	scanFile,
	type Decl,
	type FileScan,
	type Occurrence
} from './symbol-scan.js';
import type {
	DiffContext,
	FileSymbolRefs,
	SymbolLens,
	SymbolRefConfidence,
	SymbolRefLocation
} from './types.js';

const posix = path.posix;

// Importer files scanned per module before we give up and call the count "at
// least". A module imported from hundreds of files is not dead code.
const MAX_IMPORTERS = 400;
const MAX_LOCATIONS = 200;

// Languages that can import a module but that we don't scan. Finding one that
// mentions the module means we can't be sure it isn't using the symbol.
const OPAQUE_CODE = /\.(?:tsx|jsx|vue|astro|mdx)$/;

type ModuleKind = 'scan' | 'opaque' | 'ignore';

function moduleKind(file: string): ModuleKind {
	if (isScannablePath(file)) return 'scan';
	if (OPAQUE_CODE.test(file)) return 'opaque';
	return 'ignore';
}

// ---------------------------------------------------------------------------
// The repo as the diff sees it
// ---------------------------------------------------------------------------

class RepoView {
	private texts = new Map<string, Promise<string | null>>();
	private scans = new Map<string, Promise<FileScan | null>>();
	private lines = new Map<string, string[]>();
	private byName = new WeakMap<FileScan, Map<string, Occurrence[]>>();

	constructor(
		readonly repoPath: string,
		readonly snap: RepoSnapshot,
		readonly files: Set<string>
	) {}

	has(p: string): boolean {
		return this.files.has(p);
	}

	text(p: string): Promise<string | null> {
		let t = this.texts.get(p);
		if (!t) {
			t = readSnapshotFile(this.repoPath, this.snap, p);
			this.texts.set(p, t);
		}
		return t;
	}

	scan(p: string): Promise<FileScan | null> {
		let s = this.scans.get(p);
		if (!s) {
			s = this.text(p).then((text) => (text === null ? null : scanFile(text, p)));
			this.scans.set(p, s);
		}
		return s;
	}

	// Plain (non-member) occurrences of each name in a scanned file.
	occurrences(scan: FileScan, name: string): Occurrence[] {
		let index = this.byName.get(scan);
		if (!index) {
			index = new Map();
			for (const o of scan.occurrences) {
				if (o.member) continue;
				const list = index.get(o.name);
				if (list) list.push(o);
				else index.set(o.name, [o]);
			}
			this.byName.set(scan, index);
		}
		return index.get(name) ?? [];
	}

	async lineText(p: string, line: number): Promise<string> {
		let lines = this.lines.get(p);
		if (!lines) {
			lines = ((await this.text(p)) ?? '').split('\n');
			this.lines.set(p, lines);
		}
		return (lines[line - 1] ?? '').trim().slice(0, 240);
	}
}

// ---------------------------------------------------------------------------
// Module resolution
// ---------------------------------------------------------------------------

type Resolution =
	| { kind: 'file'; path: string }
	// A bare specifier that no repo alias or workspace package claims: an npm
	// dependency, or the runtime's own modules.
	| { kind: 'external' }
	// A specifier that points into the repo (relative, aliased, a workspace
	// package) but that we couldn't map to a file.
	| { kind: 'unresolved' };

const RESOLVE_EXTENSIONS = [
	'.ts',
	'.tsx',
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.mts',
	'.cts',
	'.svelte',
	'.svelte.ts',
	'.svelte.js',
	'.json'
];

const TSCONFIG_NAMES = [
	'tsconfig.json',
	'tsconfig.web.json',
	'tsconfig.app.json',
	'tsconfig.node.json',
	'tsconfig.base.json',
	'jsconfig.json'
];

// JSON with comments and trailing commas, which is what tsconfig files are.
function parseJsonc(text: string): unknown {
	let out = '';
	let i = 0;
	const n = text.length;
	while (i < n) {
		const ch = text[i];
		if (ch === '"') {
			let j = i + 1;
			while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j + 1;
			continue;
		}
		if (ch === '/' && text[i + 1] === '/') {
			while (i < n && text[i] !== '\n') i++;
			continue;
		}
		if (ch === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end < 0 ? n : end + 2;
			continue;
		}
		if (ch === '}' || ch === ']') {
			out = out.replace(/,\s*$/, '');
		}
		out += ch;
		i++;
	}
	try {
		return JSON.parse(out);
	} catch {
		return null;
	}
}

interface PackageInfo {
	name: string;
	dir: string;
	exports: unknown;
	main: string | null;
	// Published packages have consumers outside this repo.
	isPublic: boolean;
	bin: string[];
}

interface AliasEntry {
	prefix: string;
	suffix: string;
	wildcard: boolean;
	targets: string[];
}

interface Aliases {
	entries: AliasEntry[];
	baseUrl: string | null;
}

class Resolver {
	private packages: Promise<PackageInfo[]> | null = null;
	private aliasCache = new Map<string, Promise<Aliases>>();
	private configCache = new Map<string, Promise<ParsedConfig | null>>();

	constructor(private view: RepoView) {}

	// A file by extension-tolerant path: exact, then with each extension, then as
	// a directory index. `./x.js` also matches `x.ts`, the TypeScript convention.
	resolveFile(base: string): string | null {
		const v = this.view;
		if (v.has(base)) return base;
		const swap = /^(.*)\.(m?js|cjs|jsx)$/.exec(base);
		if (swap) {
			const stem = swap[1];
			const ts = swap[2] === 'mjs' ? ['.mts'] : swap[2] === 'cjs' ? ['.cts'] : ['.ts', '.tsx'];
			for (const ext of ts) if (v.has(stem + ext)) return stem + ext;
		}
		for (const ext of RESOLVE_EXTENSIONS) if (v.has(base + ext)) return base + ext;
		for (const ext of RESOLVE_EXTENSIONS)
			if (v.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
		return null;
	}

	async resolve(spec: string, from: string): Promise<Resolution> {
		if (spec.startsWith('.')) {
			const f = this.resolveFile(posix.join(posix.dirname(from), spec));
			return f ? { kind: 'file', path: f } : { kind: 'unresolved' };
		}
		if (spec.startsWith('/') || spec.startsWith('#')) return { kind: 'unresolved' };

		// SvelteKit's built-in `$lib`.
		if (spec === '$lib' || spec.startsWith('$lib/')) {
			const root = this.findUp(posix.dirname(from), ['svelte.config.js', 'svelte.config.ts']);
			if (root !== null) {
				const f = this.resolveFile(posix.join(root, 'src/lib', spec.slice(5)));
				return f ? { kind: 'file', path: f } : { kind: 'unresolved' };
			}
			return { kind: 'unresolved' };
		}

		const aliases = await this.aliasesFor(posix.dirname(from));
		const matches = aliases.entries
			.filter((e) =>
				e.wildcard
					? spec.length >= e.prefix.length + e.suffix.length &&
						spec.startsWith(e.prefix) &&
						spec.endsWith(e.suffix)
					: spec === e.prefix
			)
			.sort((a, b) => b.prefix.length - a.prefix.length);
		if (matches.length > 0) {
			const e = matches[0];
			const star = e.wildcard ? spec.slice(e.prefix.length, spec.length - e.suffix.length) : '';
			for (const t of e.targets) {
				const f = this.resolveFile(t.replace('*', star));
				if (f) return { kind: 'file', path: f };
			}
			return { kind: 'unresolved' };
		}

		const pkg = await this.packageFor(spec);
		if (pkg) {
			const f = this.resolvePackage(pkg.info, pkg.sub);
			return f ? { kind: 'file', path: f } : { kind: 'unresolved' };
		}

		if (aliases.baseUrl !== null) {
			const f = this.resolveFile(posix.join(aliases.baseUrl, spec));
			if (f) return { kind: 'file', path: f };
		}
		return { kind: 'external' };
	}

	// The nearest ancestor directory (starting at `dir`) holding any of `names`.
	private findUp(dir: string, names: string[]): string | null {
		let d = dir;
		for (;;) {
			for (const n of names) if (this.view.has(posix.join(d, n))) return d;
			if (d === '.' || d === '' || d === '/') return null;
			d = posix.dirname(d);
		}
	}

	private async loadConfig(file: string, depth = 0): Promise<ParsedConfig | null> {
		let cached = this.configCache.get(file);
		if (!cached) {
			cached = this.parseConfig(file, depth);
			this.configCache.set(file, cached);
		}
		return cached;
	}

	private async parseConfig(file: string, depth: number): Promise<ParsedConfig | null> {
		const text = await this.view.text(file);
		if (text === null) return null;
		const json = parseJsonc(text) as {
			extends?: string | string[];
			compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
		} | null;
		if (!json || typeof json !== 'object') return null;
		const dir = posix.dirname(file);
		const co = json.compilerOptions ?? {};
		let baseUrl: string | null =
			typeof co.baseUrl === 'string' ? posix.join(dir, co.baseUrl) : null;
		let paths: Record<string, string[]> | null =
			co.paths && typeof co.paths === 'object' ? co.paths : null;
		let pathsDir = dir;

		if ((baseUrl === null || paths === null) && json.extends && depth < 6) {
			const list = Array.isArray(json.extends) ? json.extends : [json.extends];
			for (const ext of list) {
				if (typeof ext !== 'string' || !ext.startsWith('.')) continue;
				let p = posix.join(dir, ext);
				if (!p.endsWith('.json')) p += '.json';
				if (!this.view.has(p)) continue;
				const parent = await this.loadConfig(p, depth + 1);
				if (!parent) continue;
				if (baseUrl === null) baseUrl = parent.baseUrl;
				if (paths === null && parent.paths) {
					paths = parent.paths;
					pathsDir = parent.pathsDir;
				}
			}
		}
		return { baseUrl, paths, pathsDir };
	}

	// Path aliases in force for files in `dir`: the union of the nearest
	// directory's tsconfig/jsconfig files.
	private aliasesFor(dir: string): Promise<Aliases> {
		let cached = this.aliasCache.get(dir);
		if (!cached) {
			cached = this.buildAliases(dir);
			this.aliasCache.set(dir, cached);
		}
		return cached;
	}

	private async buildAliases(dir: string): Promise<Aliases> {
		const root = this.findUp(dir, TSCONFIG_NAMES);
		const out: Aliases = { entries: [], baseUrl: null };
		if (root === null) return out;
		for (const name of TSCONFIG_NAMES) {
			const file = posix.join(root, name);
			if (!this.view.has(file)) continue;
			const cfg = await this.loadConfig(file);
			if (!cfg) continue;
			if (cfg.baseUrl !== null && out.baseUrl === null) out.baseUrl = cfg.baseUrl;
			if (!cfg.paths) continue;
			const base = cfg.baseUrl ?? cfg.pathsDir;
			for (const [pattern, targets] of Object.entries(cfg.paths)) {
				if (!Array.isArray(targets)) continue;
				const star = pattern.indexOf('*');
				out.entries.push({
					prefix: star < 0 ? pattern : pattern.slice(0, star),
					suffix: star < 0 ? '' : pattern.slice(star + 1),
					wildcard: star >= 0,
					targets: targets.filter((t) => typeof t === 'string').map((t) => posix.join(base, t))
				});
			}
		}
		return out;
	}

	// Every workspace package in the snapshot, by name.
	private loadPackages(): Promise<PackageInfo[]> {
		if (!this.packages) {
			this.packages = (async () => {
				const manifests = [...this.view.files].filter(
					(f) => posix.basename(f) === 'package.json' && !f.includes('node_modules/')
				);
				const found = await Promise.all(
					manifests.map(async (f): Promise<PackageInfo | null> => {
						const text = await this.view.text(f);
						if (text === null) return null;
						try {
							const j = JSON.parse(text) as Record<string, unknown>;
							if (typeof j.name !== 'string') return null;
							const main =
								typeof j.svelte === 'string'
									? j.svelte
									: typeof j.module === 'string'
										? j.module
										: typeof j.main === 'string'
											? j.main
											: null;
							const bin =
								typeof j.bin === 'string'
									? [j.bin]
									: j.bin && typeof j.bin === 'object'
										? Object.values(j.bin as Record<string, unknown>).filter(
												(b): b is string => typeof b === 'string'
											)
										: [];
							return {
								name: j.name,
								dir: posix.dirname(f),
								exports: j.exports,
								main,
								isPublic: j.private !== true,
								bin
							};
						} catch {
							return null;
						}
					})
				);
				return found.filter((p): p is PackageInfo => p !== null);
			})();
		}
		return this.packages;
	}

	private async packageFor(spec: string): Promise<{ info: PackageInfo; sub: string } | null> {
		const pkgs = await this.loadPackages();
		let best: PackageInfo | null = null;
		for (const p of pkgs) {
			if (spec === p.name || spec.startsWith(`${p.name}/`)) {
				if (!best || p.name.length > best.name.length) best = p;
			}
		}
		return best ? { info: best, sub: `.${spec.slice(best.name.length)}` } : null;
	}

	// Map a package subpath (`.` or `./x`) to a file through `exports`, falling
	// back to `main` and to the directory layout when there is no `exports`.
	private resolvePackage(pkg: PackageInfo, sub: string): string | null {
		const pick = (target: unknown): string | null => {
			if (typeof target === 'string') return target;
			if (Array.isArray(target)) {
				for (const t of target) {
					const r = pick(t);
					if (r) return r;
				}
				return null;
			}
			if (target && typeof target === 'object') {
				const obj = target as Record<string, unknown>;
				for (const key of ['svelte', 'import', 'module', 'default', 'require', 'types']) {
					if (key in obj) {
						const r = pick(obj[key]);
						if (r) return r;
					}
				}
			}
			return null;
		};

		const ex = pkg.exports;
		if (ex !== undefined && ex !== null) {
			const isSubpathMap =
				typeof ex === 'object' &&
				!Array.isArray(ex) &&
				Object.keys(ex).some((k) => k.startsWith('.'));
			const map: Record<string, unknown> = isSubpathMap
				? (ex as Record<string, unknown>)
				: { '.': ex };
			let target: string | null = null;
			if (sub in map) {
				target = pick(map[sub]);
			} else {
				let bestKey = '';
				for (const key of Object.keys(map)) {
					const star = key.indexOf('*');
					if (star < 0) continue;
					const prefix = key.slice(0, star);
					const suffix = key.slice(star + 1);
					if (
						sub.startsWith(prefix) &&
						sub.endsWith(suffix) &&
						sub.length >= prefix.length + suffix.length
					) {
						if (prefix.length > bestKey.length) bestKey = key;
					}
				}
				if (bestKey) {
					const star = bestKey.indexOf('*');
					const mid = sub.slice(star, sub.length - (bestKey.length - star - 1));
					const t = pick(map[bestKey]);
					target = t ? t.replace('*', mid) : null;
				}
			}
			return target ? this.resolveFile(posix.join(pkg.dir, target)) : null;
		}

		if (sub === '.') {
			const entries = [pkg.main, 'src/index', 'index'].filter((e): e is string => !!e);
			for (const e of entries) {
				const f = this.resolveFile(posix.join(pkg.dir, e));
				if (f) return f;
			}
			return null;
		}
		return (
			this.resolveFile(posix.join(pkg.dir, sub)) ??
			this.resolveFile(posix.join(pkg.dir, 'src', sub))
		);
	}

	// Whether `file` is an entry point (exports map, main, bin) of a package that
	// is published, so its exports have consumers we can't see.
	async isPublicEntry(file: string): Promise<boolean> {
		for (const pkg of await this.loadPackages()) {
			if (!pkg.isPublic) continue;
			for (const b of pkg.bin) {
				if (this.resolveFile(posix.join(pkg.dir, b)) === file) return true;
			}
			const ex = pkg.exports;
			if (
				ex &&
				typeof ex === 'object' &&
				!Array.isArray(ex) &&
				Object.keys(ex).some((k) => k.startsWith('.'))
			) {
				for (const key of Object.keys(ex)) {
					if (key.includes('*')) continue;
					if (this.resolvePackage(pkg, key) === file) return true;
				}
			} else if (this.resolvePackage(pkg, '.') === file) {
				return true;
			}
		}
		return false;
	}

	// The exact bare specifiers a package's `exports` (or `main`) map to `file`.
	// Wildcard exports aren't listed: they end in the file's own name, which the
	// tail search already covers.
	async packageSpecsFor(file: string): Promise<string[]> {
		const specs: string[] = [];
		for (const pkg of await this.loadPackages()) {
			const ex = pkg.exports;
			if (
				ex &&
				typeof ex === 'object' &&
				!Array.isArray(ex) &&
				Object.keys(ex).some((k) => k.startsWith('.'))
			) {
				for (const key of Object.keys(ex)) {
					if (key.includes('*')) continue;
					if (this.resolvePackage(pkg, key) === file) specs.push(pkg.name + key.slice(1));
				}
			} else if (this.resolvePackage(pkg, '.') === file) {
				specs.push(pkg.name);
			}
		}
		return specs;
	}
}

interface ParsedConfig {
	baseUrl: string | null;
	paths: Record<string, string[]> | null;
	pathsDir: string;
}

// ---------------------------------------------------------------------------
// Finding importers
// ---------------------------------------------------------------------------

// The last path segment(s) other files use to import `file`: its name without a
// JS/TS extension, plus the directory name for an `index` file.
function moduleTails(file: string): string[] {
	const name = posix.basename(file).replace(/\.(?:[cm]?[jt]s|[jt]sx)$/, '');
	const tails = [name];
	if (name === 'index') tails.push(posix.basename(posix.dirname(file)));
	return tails;
}

function specHasTail(spec: string, tails: string[]): boolean {
	const last = (spec.split('/').pop() ?? spec).replace(/\.(?:[cm]?[jt]s|[jt]sx)$/, '');
	return tails.includes(last);
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Importers {
	scannable: string[];
	opaque: string[];
	overflow: boolean;
}

async function findImporters(view: RepoView, resolver: Resolver, file: string): Promise<Importers> {
	const quote = '[\'"`]';
	const patterns = moduleTails(file).map(
		(t) => `(/|${quote})${escapeRegex(t)}(\\.[A-Za-z]+)?${quote}`
	);
	for (const spec of await resolver.packageSpecsFor(file)) {
		patterns.push(`${quote}${escapeRegex(spec)}${quote}`);
	}
	const hits = (await grepSnapshotFiles(view.repoPath, view.snap, patterns)).filter(
		(f) => f !== file && view.has(f)
	);
	const scannable: string[] = [];
	const opaque: string[] = [];
	for (const f of hits) {
		const kind = moduleKind(f);
		if (kind === 'scan') scannable.push(f);
		else if (kind === 'opaque') opaque.push(f);
	}
	const overflow = scannable.length > MAX_IMPORTERS;
	return { scannable: scannable.slice(0, MAX_IMPORTERS), opaque, overflow };
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

interface SymbolState {
	decl: Decl;
	refs: Map<string, { path: string; start: number; line: number; col: number }>;
	approximate: boolean;
	// Why the count is only a lower bound; empty when it is not.
	reasons: Set<string>;
}

// Shown in the lens tooltip when a count can't be trusted as complete.
const REASON = {
	componentProp: 'Component props are set by parent components without importing the name.',
	globalScript:
		'This file declares globals (it has no imports or exports), so anything can use them.',
	convention: 'Used by a framework or tool by convention (routes, hooks, config, generated API).',
	publicEntry: 'Part of a published package, which has consumers outside this repo.',
	dynamic: 'The module is imported dynamically somewhere.',
	unresolved: "An import that may refer to this couldn't be resolved.",
	namespace: 'The module is imported as a namespace that is used as a whole.',
	unscanned: "A file in a language we don't scan imports this module.",
	manyImporters: 'Imported from too many files to follow every one.'
} as const;

// Files whose exports are consumed by a framework or a tool by convention (file
// name, export name, directory) rather than by an import we could follow.
const CONVENTION_FILES = [
	// SvelteKit routes, hooks and param matchers.
	/(^|\/)\+(?:page|layout)(?:\.server)?\.[cm]?[jt]s$/,
	/(^|\/)\+server\.[cm]?[jt]s$/,
	/(^|\/)hooks(?:\.server|\.client)?\.[cm]?[jt]s$/,
	/(^|\/)src\/params\/[^/]+\.[cm]?[jt]s$/,
	// Tool configuration: vite.config.ts, svelte.config.js, eslint.config.js, ...
	/\.config\.[cm]?[jt]s$/,
	/(^|\/)\.storybook\//,
	/\.stories\.(?:[cm]?[jt]s|svelte)$/,
	// Convex functions are called by path through the generated `api`.
	/(^|\/)convex\//
];

// Generated code is not reviewed and its exports are all for other generated code.
const GENERATED_FILE = /(^|\/)_generated\//;

// Whether a file's top-level declarations are visible only through imports. A
// plain script (no imports or exports) declares globals that anything can use.
function isModule(scan: FileScan, file: string): boolean {
	if (file.endsWith('.svelte')) return true;
	return (
		scan.imports.length > 0 ||
		scan.reexports.length > 0 ||
		scan.localExports.length > 0 ||
		scan.decls.some((d) => d.exported || d.isDefault)
	);
}

// Which declarations earn a lens. Types and functions always do; a variable does
// when it is exported or function-like, or when it lives in a plain module
// (a Svelte instance script is mostly component state, which would be noise).
function wantsLens(d: Decl): boolean {
	if (
		d.kind === 'function' ||
		d.kind === 'class' ||
		d.kind === 'interface' ||
		d.kind === 'type' ||
		d.kind === 'enum'
	) {
		return true;
	}
	return d.exported || d.functionLike || !d.svelteInstance;
}

function exportNamesOf(decl: Decl, scan: FileScan): string[] {
	if (decl.componentProp) return [];
	const names: string[] = [];
	if (decl.isDefault) names.push('default');
	else if (decl.exported) names.push(decl.name);
	for (const le of scan.localExports) {
		if (le.local === decl.name && !names.includes(le.exported)) names.push(le.exported);
	}
	return names;
}

export async function computeSymbolRefs(
	repoPath: string,
	snap: RepoSnapshot,
	filePath: string
): Promise<FileSymbolRefs> {
	const unsupported: FileSymbolRefs = { supported: false, lineCount: 0, symbols: [] };
	if (!isScannablePath(filePath) || GENERATED_FILE.test(filePath)) return unsupported;

	const files = new Set(await listSnapshotFiles(repoPath, snap));
	if (!files.has(filePath)) return unsupported;
	const view = new RepoView(repoPath, snap, files);
	const text = await view.text(filePath);
	const scan = await view.scan(filePath);
	if (text === null || !scan) return unsupported;

	const lineCount =
		text.length === 0
			? 0
			: text.endsWith('\n')
				? text.split('\n').length - 1
				: text.split('\n').length;
	const decls = scan.decls.filter(wantsLens);
	if (decls.length === 0) return { supported: true, lineCount, symbols: [] };

	const resolver = new Resolver(view);
	const moduleFile = isModule(scan, filePath);
	const publicEntry = await resolver.isPublicEntry(filePath);
	const states = new Map<string, SymbolState>();
	for (const decl of decls) {
		const state: SymbolState = { decl, refs: new Map(), approximate: false, reasons: new Set() };
		states.set(decl.name, state);
		const add = (o: Occurrence): void => {
			state.refs.set(`${filePath}:${o.start}`, {
				path: filePath,
				start: o.start,
				line: o.line,
				col: o.col
			});
		};
		const own = view.occurrences(scan, decl.name);
		for (const o of own) add(o);
		if (own.length > 0 && scan.shadows.has(decl.name)) state.approximate = true;
		// A prop is set by parents that never import the name; a script's
		// top-level declarations are globals. Neither can be followed.
		if (decl.componentProp) state.reasons.add(REASON.componentProp);
		if (!moduleFile) state.reasons.add(REASON.globalScript);
		if (decl.exported || decl.isDefault || exportNamesOf(decl, scan).length > 0) {
			if (CONVENTION_FILES.some((re) => re.test(filePath))) state.reasons.add(REASON.convention);
			if (publicEntry) state.reasons.add(REASON.publicEntry);
		}
	}

	// For each file, the export names under which a symbol is reachable from it:
	// the declaring file first, then every barrel that re-exports it.
	const exposed = new Map<string, Map<string, string>>();
	const expose = (file: string, exportName: string, symbol: string): boolean => {
		let m = exposed.get(file);
		if (!m) {
			m = new Map();
			exposed.set(file, m);
		}
		if (m.has(exportName)) return false;
		m.set(exportName, symbol);
		return true;
	};
	for (const decl of decls) {
		for (const name of exportNamesOf(decl, scan)) expose(filePath, name, decl.name);
	}

	const markUncertain = (symbols: Iterable<string>, reason: string): void => {
		for (const s of symbols) states.get(s)?.reasons.add(reason);
	};

	const queue: string[] = exposed.has(filePath) ? [filePath] : [];
	const processed = new Map<string, number>();
	let budget = 60;

	while (queue.length > 0 && budget-- > 0) {
		const F = queue.shift()!;
		const names = exposed.get(F)!;
		if (processed.get(F) === names.size) continue;
		processed.set(F, names.size);

		const tails = moduleTails(F);
		const importers = await findImporters(view, resolver, F);
		if (importers.overflow) markUncertain(names.values(), REASON.manyImporters);
		if (importers.opaque.length > 0) markUncertain(names.values(), REASON.unscanned);

		const requeue = (file: string): void => {
			if (!queue.includes(file)) queue.push(file);
		};

		for (const C of importers.scannable) {
			if (C === F || C === filePath) continue;
			const cscan = await view.scan(C);
			if (!cscan) {
				markUncertain(names.values(), REASON.unscanned);
				continue;
			}

			const addRef = (symbol: string, o: { start: number; line: number; col: number }): void => {
				const st = states.get(symbol);
				if (st)
					st.refs.set(`${C}:${o.start}`, { path: C, start: o.start, line: o.line, col: o.col });
			};

			for (const imp of cscan.imports) {
				const res = await resolver.resolve(imp.source, C);
				if (res.kind === 'file' && res.path === F) {
					for (const b of imp.bindings) {
						if (b.kind === 'namespace') {
							for (const o of view.occurrences(cscan, b.local)) {
								if (o.access === null) {
									// The namespace escapes (passed around, indexed): any export may be used.
									markUncertain(names.values(), REASON.namespace);
								} else {
									const sym = names.get(o.access);
									if (sym) {
										addRef(sym, o);
										if (cscan.shadows.has(b.local)) states.get(sym)!.approximate = true;
									}
								}
							}
							continue;
						}
						const sym = names.get(b.imported);
						if (!sym) continue;
						const uses = view.occurrences(cscan, b.local);
						for (const o of uses) addRef(sym, o);
						if (uses.length > 0 && cscan.shadows.has(b.local)) states.get(sym)!.approximate = true;
					}
				} else if (res.kind !== 'file' && specHasTail(imp.source, tails)) {
					// An import that smells like F but that we can't resolve.
					for (const b of imp.bindings) {
						if (b.kind === 'named') {
							const sym = names.get(b.imported);
							if (sym) markUncertain([sym], REASON.unresolved);
						} else {
							markUncertain(names.values(), REASON.unresolved);
						}
					}
				}
			}

			for (const re of cscan.reexports) {
				const res = await resolver.resolve(re.source, C);
				if (res.kind === 'file' && res.path === F) {
					if (re.kind === 'named') {
						for (const item of re.items) {
							const sym = names.get(item.imported);
							if (!sym) continue;
							addRef(sym, item);
							if (expose(C, item.exported, sym)) requeue(C);
						}
					} else if (re.kind === 'star') {
						for (const [en, sym] of names) {
							if (en === 'default') continue;
							if (expose(C, en, sym)) requeue(C);
						}
					} else {
						markUncertain(names.values(), REASON.namespace);
					}
				} else if (res.kind !== 'file' && specHasTail(re.source, tails)) {
					markUncertain(names.values(), REASON.unresolved);
				}
			}

			// `import { x } from './F'; export { x }`: a re-export through a local
			// binding. It uses the symbol (it is how barrels are often written) and
			// makes it reachable from C under the exported name.
			for (const le of cscan.localExports) {
				for (const imp of cscan.imports) {
					const b = imp.bindings.find((x) => x.local === le.local);
					if (!b) continue;
					const res = await resolver.resolve(imp.source, C);
					if (res.kind !== 'file' || res.path !== F) break;
					if (b.kind === 'namespace') {
						markUncertain(names.values(), REASON.namespace);
						break;
					}
					const sym = names.get(b.imported);
					if (sym) {
						addRef(sym, le);
						if (expose(C, le.exported, sym)) requeue(C);
					}
					break;
				}
			}

			for (const dyn of cscan.dynamic) {
				if (dyn.source === null) continue;
				const res = await resolver.resolve(dyn.source, C);
				if (res.kind === 'file' ? res.path === F : specHasTail(dyn.source, tails)) {
					markUncertain(names.values(), REASON.dynamic);
				}
			}
		}
	}

	const symbols: SymbolLens[] = [];
	for (const st of states.values()) {
		const all = [...st.refs.values()].sort((a, b) => {
			const aHere = a.path === filePath ? 0 : 1;
			const bHere = b.path === filePath ? 0 : 1;
			return aHere - bHere || a.path.localeCompare(b.path) || a.line - b.line || a.col - b.col;
		});
		const shown = all.slice(0, MAX_LOCATIONS);
		const locations: SymbolRefLocation[] = await Promise.all(
			shown.map(async (r) => ({
				path: r.path,
				line: r.line,
				col: r.col,
				text: await view.lineText(r.path, r.line)
			}))
		);
		const confidence: SymbolRefConfidence =
			st.reasons.size > 0 ? 'atLeast' : st.approximate && all.length > 0 ? 'approximate' : 'exact';
		symbols.push({
			name: st.decl.name,
			kind: st.decl.kind,
			line: st.decl.line,
			exported: st.decl.exported || st.decl.isDefault,
			count: all.length,
			confidence,
			uncertainty: st.reasons.size > 0 ? [...st.reasons][0] : undefined,
			locations,
			locationsTruncated: all.length > shown.length
		});
	}
	symbols.sort((a, b) => a.line - b.line);
	return { supported: true, lineCount, symbols };
}

// The entry point the desktop app calls: resolve the diff context to the tree
// its new side lives in, then count references there.
export async function getFileSymbolRefs(
	repoPath: string,
	ctx: DiffContext,
	filePath: string
): Promise<FileSymbolRefs> {
	const snap = await resolveContextSnapshot(repoPath, ctx);
	if (!snap) return { supported: false, lineCount: 0, symbols: [] };
	return computeSymbolRefs(repoPath, snap, filePath);
}
