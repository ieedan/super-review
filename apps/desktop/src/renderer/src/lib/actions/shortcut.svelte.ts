// Vendored from shadcn-svelte-extras (ieedan/shadcn-svelte-extras,
// src/lib/actions/shortcut.svelte.ts). A keyboard-shortcut action: attach it
// to an element (or <svelte:window> for app-wide shortcuts) with one or more
// trigger definitions and a callback per trigger.

import { createAttachmentKey } from 'svelte/attachments';

export type Options = {
	/** Event to use to detect the shortcut @default 'keydown' */
	event?: 'keydown' | 'keyup' | 'keypress';
	/** Function to be called when the shortcut is pressed */
	callback: (e: KeyboardEvent) => void;
	/** Should the `Shift` key be pressed */
	shift?: boolean;
	/** Should the `Ctrl` / `Command` key be pressed */
	ctrl?: boolean;
	/** Should the `Alt` key be pressed */
	alt?: boolean;
	/** Which key should be pressed */
	key: string;
	/** Control whether or not the shortcut prevents default behavior @default true */
	preventDefault?: boolean;
	/** Control whether or not the shortcut stops propagation @default false */
	stopPropagation?: boolean;
};

export const shortcut = (node: HTMLElement, options: Options[] | Options) => {
	const handleKeydown = (e: KeyboardEvent, options: Options) => {
		if (options.ctrl && !e.ctrlKey && !e.metaKey) return;

		if (options.alt && !e.altKey) return;

		if (options.shift && !e.shiftKey) return;

		if (e.key.toLocaleLowerCase() !== options.key.toLocaleLowerCase()) return;

		if (options.preventDefault === undefined || options.preventDefault) {
			e.preventDefault();
		}

		if (options.stopPropagation) {
			e.stopPropagation();
		}

		options.callback(e);
	};

	$effect(() => {
		let optionsArr: Options[] = [];
		if (Array.isArray(options)) {
			optionsArr = options;
		} else {
			optionsArr = [options];
		}

		for (const opt of optionsArr) {
			node.addEventListener(opt.event ?? 'keydown', (e) => handleKeydown(e, opt));
		}

		return () => {
			for (const opt of optionsArr) {
				node.removeEventListener(opt.event ?? 'keydown', (e) => handleKeydown(e, opt));
			}
		};
	});
};

export function attachShortcut(opts: Options[] | Options) {
	return {
		[createAttachmentKey()]: (node: HTMLElement) => shortcut(node, opts)
	};
}
