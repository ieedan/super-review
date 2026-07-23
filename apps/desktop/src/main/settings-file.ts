import { app } from 'electron';
import { z } from 'zod';
import path from 'node:path';
import { watch, readFileSync, writeFileSync, renameSync, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { UserPrefs } from '@shared/types.js';
import {
	DEFAULT_EMPTY_VIEW_ITEMS,
	DEFAULT_FILE_HEADER_ITEMS,
	DEFAULT_HEADER_ITEMS,
	DEFAULT_SIDEBAR_CONTROLS,
	DEFAULT_SIDEBAR_TABS,
	WINDOW_BOUNDS
} from '@shared/types.js';
import { DEFAULT_HIDDEN_DIFF_PATTERNS } from '@shared/diff-defer.js';
import { DEFAULT_HOTKEYS } from '@shared/hotkeys.js';
import {
	DEFAULT_STATS_WIDGETS,
	STAT_METRICS,
	type StatMetric
} from '@super-review/core/usage-stats';

// This module owns the user-facing settings dotfile — a single, human-editable
// `settings.json` that is the live source of truth for every preference (the
// VS Code model). It sits alongside the electron-store config, but unlike that
// config it holds ONLY shareable preferences: no seen-state, file caches,
// GitHub tokens, license, or per-machine session state. Those stay in the store.
//
// The store (store.ts) composes the full UserPrefs the renderer sees from this
// file's settings plus the store's own state slice, so the renderer's IPC
// contract (getPrefs/setPrefs over a full UserPrefs) is unchanged.

// The UserPrefs keys that are machine/session STATE, not shareable settings.
// Everything else in UserPrefs lives in settings.json.
export const SETTINGS_STATE_KEYS = [
	'activeRepoId',
	'contextTab',
	'sidebarCollapsed',
	'commentsSidebarOpen',
	'commentsSidebarTab',
	'conversationFullscreen'
] as const;
export type SettingsStateKey = (typeof SETTINGS_STATE_KEYS)[number];

// The shareable preference subset of UserPrefs — the shape of settings.json.
export type AppSettings = Omit<UserPrefs, SettingsStateKey>;

// The default value for every setting. Typed as AppSettings so a new UserPrefs
// field forces a decision here (add it, or add it to SETTINGS_STATE_KEYS). This
// is also the single source of truth store.ts folds its state defaults into.
export const DEFAULT_SETTINGS: AppSettings = {
	viewMode: 'split',
	diffLayout: 'scroll',
	theme: 'dark',
	diffTheme: 'pierre',
	accent: 'super',
	externalEditor: null,
	externalTerminal: null,
	unstagedFileListLayout: 'tree',
	branchFileListLayout: 'tree',
	showFileIcons: true,
	openFileOnArrowNav: true,
	codeFont: 'system',
	uiFont: 'system',
	indentGuides: true,
	maxDiffLines: 1500,
	hiddenDiffPatterns: DEFAULT_HIDDEN_DIFF_PATTERNS,
	customFileIcons: [],
	animations: 'accents',
	prMergedBehavior: 'prompt',
	autoRemoveMergedBranch: false,
	unmarkSeenOnChange: true,
	hotkeys: DEFAULT_HOTKEYS,
	windowWidth: WINDOW_BOUNDS.defaultWidth,
	windowHeight: WINDOW_BOUNDS.defaultHeight,
	startMaximized: false,
	recentRepoCount: 5,
	changesetsEnabled: true,
	signCommits: true,
	headerItems: DEFAULT_HEADER_ITEMS,
	fileHeaderItems: DEFAULT_FILE_HEADER_ITEMS,
	sidebarTabs: DEFAULT_SIDEBAR_TABS,
	sidebarControls: DEFAULT_SIDEBAR_CONTROLS,
	statsWidgets: [...DEFAULT_STATS_WIDGETS],
	emptyViewItems: DEFAULT_EMPTY_VIEW_ITEMS
};

// The settings keys, derived from the defaults so the two can't drift. Used by
// store.ts to route a setPrefs patch (settings keys → this file, state keys →
// the store).
export const SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS)) as ReadonlySet<keyof UserPrefs>;

const editorEnum = z.enum(['cursor', 'vscode', 'zed', 'xcode', 'visualstudio']);
const terminalEnum = z.enum(['terminal', 'iterm', 'warp', 'ghostty', 'cmd', 'powershell']);
const statMetricEnum = z.enum([...STAT_METRICS] as [StatMetric, ...StatMetric[]]);
// A visibility map (headerItems, sidebarTabs, ...): a record of booleans. Kept
// loose on purpose — store.ts merges it over the typed defaults, so a partial or
// forward-compatible object is fine and only genuinely wrong value types reset.
const boolMap = z.record(z.string(), z.boolean());

// A STRICT validator per setting. Missing keys are not errors (defaults fill
// them); only a present-but-wrong value is flagged and reset. Nested objects are
// validated at the value-type level and re-merged with defaults in store.ts, so
// one bad binding resets that whole object rather than corrupting the app.
const FIELD_SCHEMAS: { [K in keyof AppSettings]-?: z.ZodType } = {
	viewMode: z.enum(['split', 'unified']),
	diffLayout: z.enum(['scroll', 'single']),
	theme: z.enum(['light', 'dark']),
	diffTheme: z.string(),
	accent: z.enum(['super', 'mono']),
	externalEditor: editorEnum.nullable(),
	externalTerminal: terminalEnum.nullable(),
	unstagedFileListLayout: z.enum(['tree', 'list']),
	branchFileListLayout: z.enum(['tree', 'list']),
	showFileIcons: z.boolean(),
	openFileOnArrowNav: z.boolean(),
	codeFont: z.string(),
	uiFont: z.string(),
	indentGuides: z.boolean(),
	maxDiffLines: z.number().min(0),
	hiddenDiffPatterns: z.array(z.string()),
	customFileIcons: z.array(z.object({ pattern: z.string(), source: z.string() })),
	animations: z.enum(['none', 'accents', 'all']),
	prMergedBehavior: z.enum(['prompt', 'switch', 'nothing']),
	autoRemoveMergedBranch: z.boolean(),
	unmarkSeenOnChange: z.boolean(),
	hotkeys: z.record(
		z.string(),
		z.object({
			key: z.string(),
			mod: z.boolean().optional(),
			shift: z.boolean().optional(),
			alt: z.boolean().optional()
		})
	),
	windowWidth: z.number().min(1),
	windowHeight: z.number().min(1),
	startMaximized: z.boolean(),
	recentRepoCount: z.number().min(0),
	changesetsEnabled: z.boolean(),
	signCommits: z.boolean(),
	headerItems: boolMap,
	fileHeaderItems: boolMap,
	sidebarTabs: boolMap,
	sidebarControls: boolMap,
	statsWidgets: z.array(statMetricEnum),
	emptyViewItems: boolMap
};

export interface ParsedSettings {
	values: AppSettings;
	// Names of settings that were present but invalid and reset to their default,
	// so the caller (import / live-apply) can tell the user what it dropped.
	reset: string[];
	// The file existed but couldn't be JSON-parsed at all. The caller keeps its
	// last-good values and must NOT overwrite the file (so the user can fix it).
	malformed: boolean;
}

// Validate a parsed-JSON blob into a complete AppSettings. Never throws: every
// field falls back to its default when missing or invalid.
function validate(raw: unknown): { values: AppSettings; reset: string[] } {
	const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const defaults = DEFAULT_SETTINGS as Record<string, unknown>;
	const values: Record<string, unknown> = {};
	const reset: string[] = [];
	for (const key of Object.keys(DEFAULT_SETTINGS)) {
		const fallback = structuredClone(defaults[key]);
		const rawVal = obj[key];
		if (rawVal === undefined) {
			values[key] = fallback;
			continue;
		}
		const schema = FIELD_SCHEMAS[key as keyof AppSettings];
		const res = schema.safeParse(rawVal);
		if (res.success) {
			values[key] = res.data;
		} else {
			reset.push(key);
			values[key] = fallback;
		}
	}
	return { values: values as AppSettings, reset };
}

export function settingsFilePath(): string {
	return path.join(app.getPath('userData'), 'settings.json');
}

// Serialize in the canonical DEFAULT_SETTINGS key order so the file stays stable
// and readable across writes (no key reshuffling in diffs).
function serialize(values: AppSettings): string {
	const ordered: Record<string, unknown> = {};
	for (const key of Object.keys(DEFAULT_SETTINGS))
		ordered[key] = (values as Record<string, unknown>)[key];
	return JSON.stringify(ordered, null, 2) + '\n';
}

// The current settings as the exact text that lives in the file — used by the
// export handler so the copy matches what's on disk regardless of key order.
export function currentSettingsText(): string {
	return serialize(getSettings());
}

// In-memory mirror so getSettings() (hit by getPrefs) doesn't re-read the file
// each time. Kept in lockstep with our own writes and with external edits the
// watcher observes. The main process is the only writer of settings.json.
let cache: AppSettings | null = null;
// The exact string we last wrote, so the watcher can tell our own writes apart
// from a real external edit (both fire fs.watch).
let lastWritten: string | null = null;

// Read and validate the file from disk (synchronously). Missing file → all
// defaults. Malformed JSON → defaults + malformed flag (caller preserves
// last-good, leaves the file be). Writes are sync too (like electron-store), so
// getPrefs/setPrefs keep their synchronous signatures and the mirror is always
// warm before the window is created.
function loadSyncFromDisk(): ParsedSettings {
	let text: string;
	try {
		text = readFileSync(settingsFilePath(), 'utf8');
	} catch {
		return { values: structuredClone(DEFAULT_SETTINGS), reset: [], malformed: false };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { values: structuredClone(DEFAULT_SETTINGS), reset: [], malformed: true };
	}
	const { values, reset } = validate(parsed);
	return { values, reset, malformed: false };
}

// The current settings, from the in-memory mirror; primes it from disk on the
// first (cold) call so a synchronous getPrefs before init still gets real data.
export function getSettings(): AppSettings {
	if (!cache) cache = loadSyncFromDisk().values;
	return cache;
}

function persistSync(values: AppSettings): void {
	const text = serialize(values);
	const target = settingsFilePath();
	const tmp = `${target}.${process.pid}.tmp`;
	writeFileSync(tmp, text, 'utf8');
	renameSync(tmp, target);
	lastWritten = text;
	cache = values;
}

// Prime the mirror at startup and seed the file from the given (store-derived)
// settings if it doesn't exist yet — the one-time migration off the electron
// store. Returns the loaded settings plus a malformed-file flag so the caller
// can warn without clobbering the user's broken edit.
export function initSettingsFile(seed: Partial<AppSettings>): ParsedSettings {
	let existed = true;
	try {
		readFileSync(settingsFilePath(), 'utf8');
	} catch {
		existed = false;
	}
	if (!existed) {
		const values = validate(seed).values;
		persistSync(values);
		return { values, reset: [], malformed: false };
	}
	const result = loadSyncFromDisk();
	cache = result.values;
	return result;
}

// Merge a settings patch into the file and mirror. Returns the new full
// settings. Used by store.setPrefs for settings-owned keys.
export function mergeSettingsFile(patch: Partial<AppSettings>): AppSettings {
	const next = { ...getSettings(), ...patch };
	persistSync(next);
	return next;
}

// Replace the whole settings file (import / reset). `raw` is validated, so an
// imported file with bad or unknown fields is sanitized. Returns the applied
// settings plus which fields were reset.
export function replaceSettingsFile(raw: unknown): { values: AppSettings; reset: string[] } {
	const { values, reset } = validate(raw);
	persistSync(values);
	return { values, reset };
}

let watcher: FSWatcher | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;

// Watch settings.json for EXTERNAL edits (the user's editor) and invoke the
// callback with the freshly validated settings. Our own writes are suppressed by
// comparing the on-disk text to the last string we wrote. Watches the directory
// (not the file) so it survives editors that replace the file via atomic rename.
export function watchSettingsFile(onExternalChange: (parsed: ParsedSettings) => void): void {
	if (watcher) return;
	const dir = app.getPath('userData');
	const name = 'settings.json';
	try {
		watcher = watch(dir, (_event, filename) => {
			if (filename && path.basename(filename.toString()) !== name) return;
			if (debounce) clearTimeout(debounce);
			debounce = setTimeout(async () => {
				let text: string;
				try {
					text = await readFile(settingsFilePath(), 'utf8');
				} catch {
					return;
				}
				// Our own write — already mirrored and broadcast by setPrefs.
				if (text === lastWritten) return;
				let parsed: ParsedSettings;
				try {
					parsed = { ...validate(JSON.parse(text)), malformed: false };
				} catch {
					parsed = { values: getSettings(), reset: [], malformed: true };
				}
				if (!parsed.malformed) cache = parsed.values;
				onExternalChange(parsed);
			}, 150);
		});
	} catch {
		// fs.watch can be unsupported on some filesystems; live-apply simply
		// won't fire there, which is a graceful degradation (restart still works).
	}
}
