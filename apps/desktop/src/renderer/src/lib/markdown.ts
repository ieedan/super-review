// GitHub-Flavored-Markdown renderer used by the file Preview toggle. `marked`
// ships GFM support (tables, strikethrough, task lists, autolinks) on by
// default, so the rendered output mirrors how GitHub displays a `.md` file.
//
// Fenced code blocks are syntax-highlighted with Shiki via the shared
// highlighter that @pierre/diffs (the diff viewer) already manages. We
// deliberately reuse it instead of Shiki's standalone `codeToHtml`: that
// convenience spins up Shiki's WASM (oniguruma) engine, which the renderer's
// CSP (`script-src 'self'`, no `wasm-unsafe-eval`) blocks — every call would
// throw and fall back to plain text. The shared highlighter uses the pure-JS
// regex engine, so it works under CSP just like the diffs do.
//
// We load the bundled `github-dark` / `github-light` themes (self-contained
// inline colors) into it rather than the diff's `pierre-*` CSS-variable
// themes, which only render in color inside the diff component's injected
// style context.
//
// The HTML is sanitized with DOMPurify before it reaches `{@html}` — repo
// contents are untrusted (often agent-written), and this runs in the Electron
// renderer where an injected script would be dangerous.
import { marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { getSharedHighlighter } from '@pierre/diffs';

type ShikiTheme = 'github-dark' | 'github-light';

// Highlight one code block with the shared JS-engine highlighter, loading the
// theme + language on demand. Falls back to a plain-text render for unknown
// languages, and to null if even that fails (the renderer emits an escaped
// <pre> in that case).
async function highlightToHtml(
	code: string,
	lang: string,
	theme: ShikiTheme
): Promise<string | null> {
	const wanted = lang || 'text';
	try {
		const hl = await getSharedHighlighter({ themes: [theme], langs: [wanted] });
		return hl.codeToHtml(code, { lang: wanted, theme });
	} catch {
		try {
			const hl = await getSharedHighlighter({ themes: [theme], langs: ['text'] });
			return hl.codeToHtml(code, { lang: 'text', theme });
		} catch {
			return null;
		}
	}
}

marked.setOptions({
	gfm: true,
	// GitHub doesn't turn a single newline into a <br> for regular `.md` files,
	// so leave `breaks` off to match its rendering.
	breaks: false
});

// Force links to open in a new context and strip referrer/opener, and never
// let a `javascript:` URL slip through (DOMPurify drops those too).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
	if (node.tagName === 'A' && node.getAttribute('href')) {
		node.setAttribute('target', '_blank');
		node.setAttribute('rel', 'noopener noreferrer');
	}
});

// Highlighted HTML for each code token, populated by the async `walkTokens`
// pass and read back in the (synchronous) `code` renderer. Keyed by the token
// object itself so concurrent renders don't collide.
const highlightedCode = new WeakMap<Tokens.Code, string>();

// Shiki theme for the in-flight `marked.parse`. Set immediately before each
// parse; safe across concurrent calls because every section renders with the
// same app theme at any given moment.
let currentShikiTheme: ShikiTheme = 'github-light';

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

marked.use({
	async: true,
	async walkTokens(token) {
		if (token.type !== 'code') return;
		const code = token as Tokens.Code;
		const lang = (code.lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
		const html = await highlightToHtml(code.text, lang, currentShikiTheme);
		if (html) highlightedCode.set(code, html);
	},
	renderer: {
		code(token: Tokens.Code) {
			const html = highlightedCode.get(token);
			if (html) {
				highlightedCode.delete(token);
				return html;
			}
			return `<pre><code>${escapeHtml(token.text)}</code></pre>`;
		}
	}
});

const FILE_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn']);

/** True when the path's extension is a Markdown one we can preview. */
export function isMarkdownPath(path: string): boolean {
	const dot = path.lastIndexOf('.');
	if (dot === -1) return false;
	return FILE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * Render Markdown source to sanitized, GFM-compatible HTML with Shiki-
 * highlighted code blocks. `theme` selects the Shiki theme to match the app.
 */
export async function renderMarkdown(src: string, theme: 'light' | 'dark'): Promise<string> {
	currentShikiTheme = theme === 'dark' ? 'github-dark' : 'github-light';
	const html = (await marked.parse(src, { async: true })) as string;
	return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
