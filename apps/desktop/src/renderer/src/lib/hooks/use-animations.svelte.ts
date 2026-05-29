import { getContext, setContext } from "svelte";

/**
 * Shared animation configuration, provided once near the app root and read by
 * any component that wants to gate shadcn-svelte's enter/exit and transition
 * classes. Components include the motion classes only when enabled:
 *
 *   const animations = useAnimations();
 *   class={cn("static classes…", animations.animationsEnabled && "transition-colors", className)}
 */
export interface AnimationConfig {
	readonly animationsEnabled: boolean;
}

const ANIMATIONS_KEY = Symbol.for("sr-animations");

// Falls back to "off" when no provider is mounted (isolated component previews,
// tests, etc.), matching the app's animations-off default.
const DEFAULT: AnimationConfig = { animationsEnabled: false };

/**
 * Provides the animation config to the component tree. Pass a getter so the
 * value stays reactive to the user's setting.
 *
 * @param enabled A getter returning whether animations are currently enabled.
 */
export function setAnimations(enabled: () => boolean): AnimationConfig {
	const config: AnimationConfig = {
		get animationsEnabled() {
			return enabled();
		},
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
