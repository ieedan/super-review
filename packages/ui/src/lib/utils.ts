import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

// Helpers used by the shadcn-svelte primitives when wrapping bits-ui.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };

// Localized relative-time formatting ("5m ago", "1mo ago", "2y ago"). Used by
// the package's metadata cards. Mirrors the desktop app's formatRelative.
const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, {
	numeric: 'always',
	style: 'narrow'
});

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
	['year', 365 * 24 * 60 * 60 * 1000],
	['month', 30 * 24 * 60 * 60 * 1000],
	['day', 24 * 60 * 60 * 1000],
	['hour', 60 * 60 * 1000],
	['minute', 60 * 1000]
];

export function formatRelative(iso: string | number): string {
	const then = new Date(iso).getTime();
	const now = Date.now();
	const diff = Math.max(0, now - then);
	for (const [unit, ms] of RELATIVE_UNITS) {
		if (diff >= ms) return relativeTimeFormat.format(-Math.floor(diff / ms), unit);
	}
	return 'just now';
}
