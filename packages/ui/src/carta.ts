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
import { Carta, type Plugin } from 'carta-md';
import { code } from '@cartamd/plugin-code';
import { emoji } from '@cartamd/plugin-emoji';
import DOMPurify from 'dompurify';
import { fade, scale } from 'svelte/transition';
import { getSharedHighlighter } from '@pierre/diffs';
import { diffThemePair } from './diff-themes';
import { getMarkdownRepoContext } from './markdown';
import GithubSuggest from './components/GithubSuggest.svelte';

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

// Minimal mdast shape we touch. Carta renders the preview through a remark
// (unified) processor, NOT the `marked` pipeline in markdown.ts, so the
// autolinking there doesn't reach the composer's Preview tab — this remark
// transformer mirrors it on the mdast so preview matches the posted comment.
interface MdNode {
	type: string;
	value?: string;
	url?: string;
	alt?: string;
	// mdast-util-to-hast reads `data.hProperties` to set attributes/classes on the
	// emitted element (used to class + size the inline mention avatar).
	data?: { hProperties?: Record<string, unknown> };
	children?: MdNode[];
}

// Split one text node's value into text + link nodes for `#123` / `@user`,
// gated on the active repo context (null off GitHub). Boundary via lookbehind:
// the trigger must follow the start or a non-word, non-entity char, so `C#5`,
// `#fff`, `&#39;` and `foo@bar.com` are left as plain text. Returns null when
// there's nothing to link, so the caller keeps the original node.
function splitGithubRefs(value: string): MdNode[] | null {
	const ctx = getMarkdownRepoContext();
	if (!ctx) return null;
	const re = /(?<![\w`&])#(\d+)\b|(?<![\w`&/])@([a-z\d](?:-?[a-z\d]){0,38})/gi;
	const nodes: MdNode[] = [];
	let last = 0;
	let match: RegExpExecArray | null;
	let found = false;
	while ((match = re.exec(value)) !== null) {
		const [full, num, login] = match;
		if (match.index > last) nodes.push({ type: 'text', value: value.slice(last, match.index) });
		if (num != null) {
			nodes.push(linkNode(`#${num}`, `https://github.com/${ctx.owner}/${ctx.repo}/issues/${num}`));
		} else {
			nodes.push(mentionNode(login));
		}
		last = match.index + full.length;
		found = true;
	}
	if (!found) return null;
	if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) });
	return nodes;
}

function linkNode(text: string, url: string): MdNode {
	return { type: 'link', url, children: [{ type: 'text', value: text }] };
}

// A mention link with the user's avatar inline before the handle. The avatar is
// GitHub's deterministic `github.com/<login>.png`, so no lookup is needed.
function mentionNode(login: string): MdNode {
	return {
		type: 'link',
		url: `https://github.com/${login}`,
		children: [
			{
				type: 'image',
				url: `https://github.com/${login}.png?size=40`,
				alt: '',
				data: { hProperties: { className: ['gh-mention-avatar'], width: 20, height: 20 } }
			},
			{ type: 'text', value: `@${login}` }
		]
	};
}

// Walk the mdast, replacing refs inside text nodes. Skips code / inlineCode /
// existing links so references inside them stay literal (as GitHub does).
function autolinkGithubRefs(node: MdNode): void {
	if (!Array.isArray(node.children)) return;
	const out: MdNode[] = [];
	let changed = false;
	for (const child of node.children) {
		if (child.type === 'text' && typeof child.value === 'string') {
			const parts = splitGithubRefs(child.value);
			if (parts) {
				out.push(...parts);
				changed = true;
				continue;
			}
			out.push(child);
		} else {
			if (child.type !== 'inlineCode' && child.type !== 'code' && child.type !== 'link') {
				autolinkGithubRefs(child);
			}
			out.push(child);
		}
	}
	if (changed) node.children = out;
}

// GitHub @mention / #reference typeahead, wired as two `input` components (one
// per trigger) the way plugin-emoji registers its picker. The GithubSuggest
// component pulls its data (assignable users, recent issues/PRs) from the active
// repo via the preload bridge, so nothing repo-specific is baked in here — the
// same shared Carta instance serves whichever repo is active. The remark
// transformer autolinks the same refs in the Preview tab.
const githubSuggestPlugin: Plugin = {
	transformers: [
		{
			execution: 'sync',
			type: 'remark',
			transform({ processor }) {
				processor.use(() => (tree: MdNode) => autolinkGithubRefs(tree));
			}
		}
	],
	components: [
		{
			component: GithubSuggest,
			parent: 'input',
			props: {
				kind: 'mention',
				inTransition: (node: Element) => scale(node, { duration: 100, start: 0.98 }),
				outTransition: (node: Element) => fade(node, { duration: 80 })
			}
		},
		{
			component: GithubSuggest,
			parent: 'input',
			props: {
				kind: 'issue',
				inTransition: (node: Element) => scale(node, { duration: 100, start: 0.98 }),
				outTransition: (node: Element) => fade(node, { duration: 80 })
			}
		}
	]
};

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
		extensions: [code({ lazy: true, fallbackLanguage: 'text' }), emoji(), githubSuggestPlugin]
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
