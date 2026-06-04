// Configurable keyboard shortcuts. A binding is stored as a normalized key plus
// the modifier flags that must be held. `mod` is the platform-primary modifier:
// Cmd on macOS, Ctrl on Windows/Linux — matched against either at runtime so the
// same stored binding works cross-platform.
export interface Hotkey {
	// Normalized primary key. Single-character keys are lower-cased (e.g. "p");
	// named keys keep their KeyboardEvent.key form (e.g. "/", "Enter", "ArrowUp").
	key: string;
	// Cmd (macOS) / Ctrl (Windows/Linux).
	mod?: boolean;
	shift?: boolean;
	alt?: boolean;
}

// The set of actions whose shortcut is user-configurable. Add an entry here, a
// label in HOTKEY_LABELS, and a default in DEFAULT_HOTKEYS to surface a new one.
export const HOTKEY_ACTIONS = [
	'searchFilesPalette',
	'searchFilesSidebar',
	'toggleSidebar',
	'openSettings'
] as const;

export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number];

export type Hotkeys = Record<HotkeyAction, Hotkey>;

export const HOTKEY_LABELS: Record<HotkeyAction, { label: string; description: string }> = {
	searchFilesPalette: {
		label: 'Search files (command palette)',
		description: 'Open the fuzzy file-search palette.'
	},
	searchFilesSidebar: {
		label: 'Search files (sidebar)',
		description: 'Jump to the file-search box in the sidebar.'
	},
	toggleSidebar: {
		label: 'Toggle sidebar',
		description: 'Collapse or expand the file-list sidebar.'
	},
	openSettings: {
		label: 'Open settings',
		description: 'Open the settings dialog.'
	}
};

export const DEFAULT_HOTKEYS: Hotkeys = {
	searchFilesPalette: { key: 'p', mod: true },
	searchFilesSidebar: { key: '/' },
	toggleSidebar: { key: 'b', mod: true },
	openSettings: { key: ',', mod: true }
};

// Collapse a KeyboardEvent.key into our canonical form: single characters are
// lower-cased so Shift state is tracked via the `shift` flag rather than the
// key's case, while named keys ("Enter", "/", "ArrowUp") pass through.
export function normalizeHotkeyKey(key: string): string {
	return key.length === 1 ? key.toLowerCase() : key;
}

// True when a key combination is a bare modifier press (no primary key yet).
// Used by the recorder to keep listening until a real key lands.
export function isModifierKey(key: string): boolean {
	return (
		key === 'Meta' ||
		key === 'Control' ||
		key === 'Shift' ||
		key === 'Alt' ||
		key === 'AltGraph' ||
		key === 'OS'
	);
}

// The subset of KeyboardEvent we read. Declared structurally so this module
// stays usable in the main process too, whose tsconfig omits the DOM lib.
export interface KeyboardEventLike {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

export function matchesHotkey(e: KeyboardEventLike, hk: Hotkey | undefined | null): boolean {
	if (!hk) return false;
	if (normalizeHotkeyKey(e.key) !== hk.key) return false;
	const mod = e.metaKey || e.ctrlKey;
	if (Boolean(hk.mod) !== mod) return false;
	if (Boolean(hk.shift) !== e.shiftKey) return false;
	if (Boolean(hk.alt) !== e.altKey) return false;
	return true;
}

// True when two bindings would fire on the same key combination.
export function hotkeysEqual(a: Hotkey, b: Hotkey): boolean {
	return (
		a.key === b.key &&
		Boolean(a.mod) === Boolean(b.mod) &&
		Boolean(a.shift) === Boolean(b.shift) &&
		Boolean(a.alt) === Boolean(b.alt)
	);
}

// Human-readable label for a single key, used when rendering a binding.
function keyLabel(key: string): string {
	const named: Record<string, string> = {
		' ': 'Space',
		ArrowUp: '↑',
		ArrowDown: '↓',
		ArrowLeft: '←',
		ArrowRight: '→',
		Enter: 'Enter',
		Escape: 'Esc',
		Backspace: '⌫',
		Tab: 'Tab'
	};
	if (named[key]) return named[key];
	return key.length === 1 ? key.toUpperCase() : key;
}

// Split a binding into ordered display parts (modifiers first, key last) for
// rendering as a row of <Kbd> chips. Modifier glyphs match the host platform.
export function formatHotkeyParts(hk: Hotkey, isMac: boolean): string[] {
	const parts: string[] = [];
	if (hk.mod) parts.push(isMac ? '⌘' : 'Ctrl');
	if (hk.alt) parts.push(isMac ? '⌥' : 'Alt');
	if (hk.shift) parts.push(isMac ? '⇧' : 'Shift');
	parts.push(keyLabel(hk.key));
	return parts;
}
