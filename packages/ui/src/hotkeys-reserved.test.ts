import { describe, expect, it } from 'vitest';
import {
	DEFAULT_HOTKEYS,
	HOTKEY_ACTIONS,
	MENU_ACCELERATORS,
	matchesHotkey,
	reservedHotkeyLabel
} from '@super-review/core/hotkeys';

describe('reservedHotkeyLabel', () => {
	it('claims the combinations our own menu items own', () => {
		expect(reservedHotkeyLabel({ key: 'p', mod: true })).toBe('Push');
		expect(reservedHotkeyLabel({ key: 'p', mod: true, shift: true })).toBe('Pull');
		expect(reservedHotkeyLabel({ key: 'p', mod: true, alt: true })).toBe('Preview pull request');
		expect(reservedHotkeyLabel({ key: 'Backspace', mod: true })).toBe('Remove repository');
	});

	it('claims combinations owned by Electron role submenus', () => {
		expect(reservedHotkeyLabel({ key: 'r', mod: true })).toBe('Reload');
		expect(reservedHotkeyLabel({ key: 'a', mod: true })).toBe('Select all');
	});

	it('leaves unclaimed combinations alone', () => {
		expect(reservedHotkeyLabel({ key: 'k', mod: true })).toBeNull();
		expect(reservedHotkeyLabel({ key: 'p' })).toBeNull();
		expect(reservedHotkeyLabel({ key: 'p', shift: true })).toBeNull();
	});
});

// A default that collides with a menu accelerator can never fire, and getPrefs()
// would silently reset it to itself on every read.
describe('DEFAULT_HOTKEYS', () => {
	it('binds no action to a reserved combination', () => {
		for (const action of HOTKEY_ACTIONS) {
			expect([action, reservedHotkeyLabel(DEFAULT_HOTKEYS[action])]).toEqual([action, null]);
		}
	});

	it('binds each action to a distinct combination', () => {
		const seen = new Map<string, string>();
		for (const action of HOTKEY_ACTIONS) {
			const hk = DEFAULT_HOTKEYS[action];
			const sig = `${hk.key}|${!!hk.mod}|${!!hk.shift}|${!!hk.alt}`;
			expect(seen.get(sig)).toBeUndefined();
			seen.set(sig, action);
		}
	});

	it('opens the file palette on mod+K, not the Push accelerator', () => {
		const modK = { key: 'k', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
		const modP = { key: 'p', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
		expect(matchesHotkey(modK, DEFAULT_HOTKEYS.searchFilesPalette)).toBe(true);
		expect(matchesHotkey(modP, DEFAULT_HOTKEYS.searchFilesPalette)).toBe(false);
	});
});

describe('MENU_ACCELERATORS', () => {
	it('assigns each accelerator to exactly one menu item', () => {
		const accels = Object.values(MENU_ACCELERATORS).map((a) => a.accelerator);
		expect(new Set(accels).size).toBe(accels.length);
	});
});
