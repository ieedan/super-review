import { getContext, setContext } from 'svelte';
import type { AnimationMode } from '@shared/types';

/**
 * Shared animation configuration, provided once near the app root and read by
 * any component that wants to gate shadcn-svelte's enter/exit and transition
 * classes. The user picks one of three modes (see AnimationMode); components
 * gate their motion classes on the level they belong to:
 *
 *   const animations = useAnimations();
 *   // accent-level motion (hover/focus transitions, counters):
 *   class={cn("…", animations.accentsEnabled && "transition-colors", className)}
 *   // overlay surfaces (menus, dialogs, tooltips, popovers, sheets):
 *   class={cn("…", animations.menusEnabled && "data-[state=open]:animate-in", className)}
 */
export interface AnimationConfig {
	/** The raw mode the user selected. */
	readonly mode: AnimationMode;
	/** Accent-level motion: on for 'accents' and 'all'. */
	readonly accentsEnabled: boolean;
	/** Enter/exit motion for overlay surfaces: on only for 'all'. */
	readonly menusEnabled: boolean;
}

const ANIMATIONS_KEY = Symbol.for('sr-animations');

// Falls back to "none" when no provider is mounted (isolated component previews,
// tests, etc.) so nothing animates unexpectedly outside the app shell.
const DEFAULT: AnimationConfig = { mode: 'none', accentsEnabled: false, menusEnabled: false };

/**
 * Provides the animation config to the component tree. Pass a getter so the
 * value stays reactive to the user's setting.
 *
 * @param mode A getter returning the user's current animation mode.
 */
export function setAnimations(mode: () => AnimationMode): AnimationConfig {
	const config: AnimationConfig = {
		get mode() {
			return mode();
		},
		get accentsEnabled() {
			return mode() !== 'none';
		},
		get menusEnabled() {
			return mode() === 'all';
		}
	};
	return setContext(ANIMATIONS_KEY, config);
}

/**
 * Retrieves the animation config from context. Returns a disabled default when
 * no provider is present.
 */
export function useAnimations(): AnimationConfig {
	return getContext<AnimationConfig>(ANIMATIONS_KEY) ?? DEFAULT;
}
