// Resolves monorepo dependency specifiers for the package.json hover cards.
// `catalog:` defers a dependency's range to a catalog (pnpm-workspace.yaml, or
// the root package.json for bun), and `workspace:` links a package from the
// repo itself, which is often never published. Neither can be looked up on npm
// as written, so the card asks here for the real range / the local manifest.
//
// Everything is read from the working tree on each call: the files are small,
// and re-reading means an edited catalog or package shows up on the next hover.

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { listPackageJsonPaths } from '@super-review/core';
import type {
	WorkspaceCatalogs,
	WorkspaceCatalogsResult,
	WorkspacePackageInfo,
	WorkspacePackageResult
} from '@shared/types.js';
import { normalizeRepositoryUrl } from './npm-service.js';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(file: string): Promise<Json | null> {
	try {
		const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

async function readPnpmWorkspace(repoDir: string): Promise<Json | null> {
	try {
		const parsed: unknown = parseYaml(
			await readFile(path.join(repoDir, 'pnpm-workspace.yaml'), 'utf8')
		);
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

// Keep only string ranges out of a `{ pkg: range }` map.
function rangeMap(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!isObject(value)) return out;
	for (const [name, range] of Object.entries(value)) {
		if (typeof range === 'string') out[name] = range;
	}
	return out;
}

// Merge one source's `catalog` (the default) + `catalogs` (named) into `into`.
// Earlier sources win, so pnpm-workspace.yaml takes precedence over package.json.
function addCatalogs(into: WorkspaceCatalogs, catalog: unknown, catalogs: unknown): void {
	const add = (name: string, value: unknown): void => {
		into[name] = { ...rangeMap(value), ...into[name] };
	};
	if (catalog !== undefined) add('default', catalog);
	if (isObject(catalogs)) {
		for (const [name, value] of Object.entries(catalogs)) add(name, value);
	}
}

export async function getWorkspaceCatalogs(repoDir: string): Promise<WorkspaceCatalogsResult> {
	try {
		const [pnpm, rootPkg] = await Promise.all([
			readPnpmWorkspace(repoDir),
			readJson(path.join(repoDir, 'package.json'))
		]);
		const catalogs: WorkspaceCatalogs = {};
		if (pnpm) addCatalogs(catalogs, pnpm.catalog, pnpm.catalogs);
		if (rootPkg) {
			// bun accepts catalogs at the top level or nested under `workspaces`.
			const ws = rootPkg.workspaces;
			if (isObject(ws)) addCatalogs(catalogs, ws.catalog, ws.catalogs);
			addCatalogs(catalogs, rootPkg.catalog, rootPkg.catalogs);
		}
		return { ok: true, catalogs };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

// Workspace package globs from pnpm-workspace.yaml or package.json `workspaces`
// (an array, or `{ packages }` for yarn/bun).
async function workspacePatterns(repoDir: string, rootPkg: Json | null): Promise<string[]> {
	const pnpm = await readPnpmWorkspace(repoDir);
	const fromPnpm = pnpm?.packages;
	if (Array.isArray(fromPnpm)) return fromPnpm.filter((p): p is string => typeof p === 'string');
	const ws = rootPkg?.workspaces;
	const list = Array.isArray(ws) ? ws : isObject(ws) ? ws.packages : undefined;
	return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
}

// Workspace globs are directory globs like `packages/*` or `apps/**`. Translate
// to an anchored regex over the package's repo-relative directory.
function globToRegExp(glob: string): RegExp {
	const clean = glob.replace(/^\.\//, '').replace(/\/+$/, '');
	let re = '';
	for (let i = 0; i < clean.length; i++) {
		const ch = clean[i];
		if (ch === '*' && clean[i + 1] === '*') {
			const slash = clean[i + 2] === '/';
			re += slash ? '(?:.*/)?' : '.*';
			i += slash ? 2 : 1;
		} else if (ch === '*') {
			re += '[^/]*';
		} else if (ch === '?') {
			re += '[^/]';
		} else {
			re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${re}$`);
}

function trimManifest(pkg: Json, dir: string): WorkspacePackageInfo {
	const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
	const license = isObject(pkg.license) ? str(pkg.license.type) : str(pkg.license);
	const author = isObject(pkg.author) ? str(pkg.author.name) : str(pkg.author);
	const repository = isObject(pkg.repository)
		? { url: str(pkg.repository.url) }
		: str(pkg.repository);
	return {
		name: str(pkg.name) ?? '',
		version: str(pkg.version),
		description: str(pkg.description),
		homepage: str(pkg.homepage),
		repositoryUrl: normalizeRepositoryUrl(repository),
		license,
		author,
		keywords: Array.isArray(pkg.keywords)
			? pkg.keywords.filter((k): k is string => typeof k === 'string').slice(0, 12)
			: undefined,
		private: pkg.private === true ? true : undefined,
		path: dir
	};
}

export async function getWorkspacePackage(
	repoDir: string,
	name: string
): Promise<WorkspacePackageResult> {
	try {
		const rootPkg = await readJson(path.join(repoDir, 'package.json'));
		const patterns = await workspacePatterns(repoDir, rootPkg);
		const include = patterns.filter((p) => !p.startsWith('!')).map(globToRegExp);
		const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => globToRegExp(p.slice(1)));

		// The root package is always part of the workspace.
		if (rootPkg?.name === name) return { ok: true, info: trimManifest(rootPkg, '.') };
		if (include.length === 0) return { ok: true, info: null };

		const dirs = (await listPackageJsonPaths(repoDir))
			.map((file) => path.posix.dirname(file))
			.filter((dir) => dir !== '.')
			.filter((dir) => include.some((re) => re.test(dir)) && !exclude.some((re) => re.test(dir)));

		for (const dir of dirs) {
			const pkg = await readJson(path.join(repoDir, dir, 'package.json'));
			if (pkg?.name === name) return { ok: true, info: trimManifest(pkg, dir) };
		}
		return { ok: true, info: null };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
