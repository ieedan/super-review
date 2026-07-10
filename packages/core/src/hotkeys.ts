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
	'openRepoPicker',
	'openBranchPicker',
	'toggleSidebar',
	'toggleCommentsSidebar',
	'openConversationSidebar',
	'openSettings',
	'markSeenNext'
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
	openRepoPicker: {
		label: 'Open repository picker',
		description: 'Open the repository switcher in the header.'
	},
	openBranchPicker: {
		label: 'Open branch picker',
		description: 'Open the branch / pull request picker in the header.'
	},
	toggleSidebar: {
		label: 'Toggle sidebar',
		description: 'Collapse or expand the file-list sidebar.'
	},
	toggleCommentsSidebar: {
		label: 'Toggle comments sidebar',
		description: 'Open or close the comments sidebar.'
	},
	openConversationSidebar: {
		label: 'Open PR conversation',
		description: "Open the comments sidebar to a pull request's Conversation tab."
	},
	openSettings: {
		label: 'Open settings',
		description: 'Open the settings dialog.'
	},
	markSeenNext: {
		label: 'Mark seen & next',
		description: 'Mark the current change as seen and jump to the next change.'
	}
};

export const DEFAULT_HOTKEYS: Hotkeys = {
	// Not mod+P: the native Repository menu owns that for Push, and Electron
	// dispatches menu accelerators before the renderer ever sees the keydown.
	searchFilesPalette: { key: 'k', mod: true },
	searchFilesSidebar: { key: '/' },
	openRepoPicker: { key: 'r', shift: true },
	openBranchPicker: { key: 'b', shift: true },
	toggleSidebar: { key: 'b', mod: true },
	toggleCommentsSidebar: { key: 'l', mod: true },
	openConversationSidebar: { key: 'l', mod: true, shift: true },
	openSettings: { key: ',', mod: true },
	markSeenNext: { key: 'Enter', mod: true }
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

// A key combination already owned by the desktop app's native menus. Electron
// dispatches menu accelerators before the keystroke reaches the renderer, so a
// configurable hotkey bound to one of these silently never fires. `accelerator`
// is the Electron accelerator string and is the single source of truth: the menu
// builds its items from these entries, and the settings UI refuses to bind onto
// them.
export interface MenuAccelerator {
	// The menu item that owns the combination, for the conflict message.
	label: string;
	accelerator: string;
}

// Accelerators declared by our own submenus (see apps/desktop/src/main/menu.ts).
export const MENU_ACCELERATORS = {
	push: { label: 'Push', accelerator: 'CmdOrCtrl+P' },
	pull: { label: 'Pull', accelerator: 'Shift+CmdOrCtrl+P' },
	fetch: { label: 'Fetch', accelerator: 'Shift+CmdOrCtrl+T' },
	removeRepo: { label: 'Remove repository', accelerator: 'CmdOrCtrl+Backspace' },
	viewOnGithub: { label: 'View on GitHub', accelerator: 'Shift+CmdOrCtrl+G' },
	openInTerminal: { label: 'Open in terminal', accelerator: 'Control+`' },
	showInFinder: { label: 'Reveal in file manager', accelerator: 'Shift+CmdOrCtrl+F' },
	openInEditor: { label: 'Open in editor', accelerator: 'Shift+CmdOrCtrl+A' },
	createIssue: { label: 'Create issue on GitHub', accelerator: 'CmdOrCtrl+I' },
	newBranch: { label: 'New branch', accelerator: 'Shift+CmdOrCtrl+N' },
	updateFromDefault: { label: 'Update from default branch', accelerator: 'Shift+CmdOrCtrl+U' },
	deleteBranch: { label: 'Delete branch', accelerator: 'Shift+CmdOrCtrl+D' },
	discardAll: { label: 'Discard all changes', accelerator: 'Shift+CmdOrCtrl+Backspace' },
	previewPR: { label: 'Preview pull request', accelerator: 'Alt+CmdOrCtrl+P' },
	sendFeedback: { label: 'Send feedback', accelerator: 'Shift+CmdOrCtrl+/' }
} as const satisfies Record<string, MenuAccelerator>;

// Accelerators we inherit from Electron's built-in role submenus (file, edit,
// view, window). Not exhaustive across platforms, but it covers the combinations
// a user is likely to reach for.
const ROLE_ACCELERATORS: MenuAccelerator[] = [
	{ label: 'Close window', accelerator: 'CmdOrCtrl+W' },
	{ label: 'Minimize', accelerator: 'CmdOrCtrl+M' },
	{ label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
	{ label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z' },
	{ label: 'Cut', accelerator: 'CmdOrCtrl+X' },
	{ label: 'Copy', accelerator: 'CmdOrCtrl+C' },
	{ label: 'Paste', accelerator: 'CmdOrCtrl+V' },
	{ label: 'Select all', accelerator: 'CmdOrCtrl+A' },
	{ label: 'Reload', accelerator: 'CmdOrCtrl+R' },
	{ label: 'Force reload', accelerator: 'Shift+CmdOrCtrl+R' },
	{ label: 'Toggle developer tools', accelerator: 'Alt+CmdOrCtrl+I' },
	{ label: 'Actual size', accelerator: 'CmdOrCtrl+0' }
];

const RESERVED_ACCELERATORS: MenuAccelerator[] = [
	...Object.values(MENU_ACCELERATORS),
	...ROLE_ACCELERATORS
];

// Parse an Electron accelerator into our Hotkey shape so it can be compared with
// a configurable binding. Returns null for accelerators using modifiers a Hotkey
// can't express. A literal `Control` maps onto `mod`, which is deliberately
// over-broad on macOS (⌃ and ⌘ are distinct there) — reserving slightly more
// than we must is the safe direction.
function parseAccelerator(accelerator: string): Hotkey | null {
	const parts = accelerator.split('+');
	const key = parts.pop();
	if (!key) return null;
	const hk: Hotkey = { key: normalizeHotkeyKey(key) };
	for (const part of parts) {
		if (part === 'CmdOrCtrl' || part === 'Cmd' || part === 'Command' || part === 'Control') {
			hk.mod = true;
		} else if (part === 'Shift') {
			hk.shift = true;
		} else if (part === 'Alt' || part === 'Option') {
			hk.alt = true;
		} else {
			return null;
		}
	}
	return hk;
}

// The menu item that already owns this combination, if any. A binding that
// collides with one can never fire, so callers treat it as a hard conflict.
export function reservedHotkeyLabel(hk: Hotkey): string | null {
	for (const reserved of RESERVED_ACCELERATORS) {
		const parsed = parseAccelerator(reserved.accelerator);
		if (parsed && hotkeysEqual(parsed, hk)) return reserved.label;
	}
	return null;
}

// Human-readable label for a single key, used when rendering a binding.
function keyLabel(key: string): string {
	const named: Record<string, string> = {
		' ': 'Space',
		ArrowUp: '↑',
		ArrowDown: '↓',
		ArrowLeft: '←',
		ArrowRight: '→',
		Enter: '⏎',
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
