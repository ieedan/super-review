// Carta instances powering the GitHub-style markdown editor used when writing
// review comments (see MarkdownComposer.svelte). One instance is created per
// diff-theme preset and reused — Carta is designed to be shared, and this avoids
// re-instantiating the plugins on every comment box.
//
// CRITICAL: carta-md's own `highlighter()` builds Shiki with the WASM oniguruma
// engine. The desktop renderer's CSP (`script-src 'self'`, no `wasm-unsafe-eval`)
// blocks WASM, so that highlighter throws the moment it's created. And because
// `carta.render()` awaits `this.highlighter()` (for `loadNestedLanguages`) before
// the code plugin ever runs, the whole preview render rejects and the Preview tab
// stays stuck on the un-highlighted SSR output — code blocks show as plain text.
//
// Fix: override the instance's `highlighter()` to return the SAME pure-JS-engine
// Shiki highlighter that @pierre/diffs (the diff viewer) and posted comments
// already use (see markdown.ts). It runs fine under CSP and already has every diff
// theme resolvable, so the composer preview highlights with the user's configured
// diff theme — consistent with the diffs and the posted comment bodies.
//
// Plugins mirror GitHub's comment editor:
//   - code:  Shiki highlighting of fenced code in the preview (fed our highlighter)
//   - emoji: `:emoji:` autocomplete picker
// We deliberately omit plugin-slash (the `/` menu) and plugin-attachment (needs an
// upload endpoint this desktop app doesn't have).
import { Carta } from 'carta-md';
import { code } from '@cartamd/plugin-code';
import { emoji } from '@cartamd/plugin-emoji';
import DOMPurify from 'dompurify';
import { getSharedHighlighter } from '@pierre/diffs';
import { diffThemePair } from './diff-themes';

// Force links rendered in the preview to open in a new context and never let a
// `javascript:` URL slip through — same hardening applied in markdown.ts. The hook
// is registered globally on DOMPurify, so registering it here is harmless even if
// markdown.ts also adds it (DOMPurify de-dupes identical hooks by ref, and this is
// a separate closure that simply runs the same safe mutation).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A' && node.getAttribute('href')) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	}
});

// The subset of carta-md's highlighter contract that the editor + code plugin
// actually use: `carta.render()` → loadNestedLanguages, the code plugin (reads
// `shikiHighlighter()`, `settings.themeHash`, `utils.isSingleTheme`), and the
// Write-tab source overlay (`codeToHtml`). We implement it over @pierre/diffs'
// shared Shiki instance instead of carta's WASM one.
type SharedShiki = Awaited<ReturnType<typeof getSharedHighlighter>>;
interface CartaHighlighter {
	shikiHighlighter: () => SharedShiki;
	settings: { themeHash: { light: string; dark: string } };
	utils: { isSingleTheme: (theme: unknown) => boolean };
	codeToHtml: (code: string) => string;
}

// Build carta's `highlighter()` override for a diff-theme preset. Resolves the
// shared highlighter (loading both theme variants) once, lazily, then caches it.
function sharedCartaHighlighter(diffThemeId: string): () => Promise<CartaHighlighter> {
	const { light, dark } = diffThemePair(diffThemeId);
	let cached: Promise<CartaHighlighter> | null = null;
	return () => {
		if (cached) return cached;
		cached = (async () => {
			// 'markdown' powers the Write-tab source overlay; both theme variants must
			// be resolved so the dual-theme preview can pick light/dark.
			const hl = await getSharedHighlighter({ themes: [light, dark], langs: ['markdown'] });
			return {
				shikiHighlighter: () => hl,
				// Dual theme: the code plugin reads this and forwards it as `themes`, so
				// the preview emits the light color inline plus a `--shiki-dark` var that
				// carta-theme.css swaps in under `.dark`.
				settings: { themeHash: { light, dark } },
				utils: {
					isSingleTheme: (theme) =>
						!(theme != null && typeof theme === 'object' && 'light' in theme && 'dark' in theme)
				},
				// Write-tab overlay highlights the raw markdown source; fall back to
				// plain text if the markdown grammar isn't resolved yet.
				codeToHtml: (source) => {
					try {
						return hl.codeToHtml(source, { lang: 'markdown', themes: { light, dark } });
					} catch {
						return hl.codeToHtml(source, { lang: 'text', themes: { light, dark } });
					}
				}
			};
		})();
		return cached;
	};
}

// One Carta instance per diff-theme preset id, memoized so switching themes back
// and forth reuses instances and the common case allocates just one.
const cartaByTheme = new Map<string, Carta>();

/**
 * The shared Carta instance for the given diff-theme preset id. Its preview and
 * Write-tab highlighting run on @pierre/diffs' CSP-safe pure-JS Shiki highlighter,
 * themed to that preset. Callers should pass `app.diffTheme` reactively so the
 * composer tracks the user's configured theme.
 */
export function getCarta(diffThemeId: string): Carta {
	const existing = cartaByTheme.get(diffThemeId);
	if (existing) return existing;
	const instance = new Carta({
		// Carta operates on raw markdown and injects the result via {@html}; sanitize
		// before it reaches the DOM (the app treats sanitization as non-negotiable).
		sanitizer: (html) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }),
		// `lazy` loads each fenced block's language on demand; `fallbackLanguage`
		// keeps an unknown language from throwing (which would reject the render). No
		// `theme` — the code plugin inherits it from our highlighter's `themeHash`.
		extensions: [code({ lazy: true, fallbackLanguage: 'text' }), emoji()]
	});
	// Replace carta-md's WASM highlighter with our CSP-safe shared one. This is an
	// instance-property override shadowing the prototype method carta invokes via
	// `this.highlighter()`; see the file header for why this is necessary.
	(instance as unknown as { highlighter: () => Promise<CartaHighlighter> }).highlighter =
		sharedCartaHighlighter(diffThemeId);
	cartaByTheme.set(diffThemeId, instance);
	return instance;
}

// CSS class Carta applies to the editor and the plugin popups when we pass
// `theme="github"` to <MarkdownEditor>. Kept here so the component and the
// stylesheet agree on the name.
export const CARTA_THEME = 'github';
