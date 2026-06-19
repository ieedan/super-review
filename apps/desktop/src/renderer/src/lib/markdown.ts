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
import { marked, type RendererThis, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { emojify } from 'node-emoji';
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

// GitHub-Flavored-Markdown alerts: a blockquote whose first line is a marker
// like `> [!NOTE]` renders as a colored callout instead of a plain quote. The
// marker must be the whole first line; anything else is a normal blockquote.
// https://docs.github.com/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#alerts
const ALERT_RE = /^[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n|$)/i;
const ALERT_TITLES: Record<string, string> = {
	note: 'Note',
	tip: 'Tip',
	important: 'Important',
	warning: 'Warning',
	caution: 'Caution'
};

marked.use({
	async: true,
	async walkTokens(token) {
		// Replace GitHub `:shortcode:` emoji with the unicode glyph, GitHub-style.
		// Scoped to leaf text tokens so shortcodes inside code spans / fenced blocks
		// (types 'codespan' / 'code') are left verbatim. A text token that owns child
		// tokens renders those, not `.text`, so mutating it there is a harmless no-op.
		if (token.type === 'text') {
			const t = token as Tokens.Text;
			if (t.text.includes(':')) t.text = emojify(t.text);
			return;
		}
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
		},
		blockquote(this: RendererThis, token: Tokens.Blockquote) {
			const m = ALERT_RE.exec(token.text);
			if (!m) return `<blockquote>\n${this.parser.parse(token.tokens)}</blockquote>\n`;
			const type = m[1].toLowerCase();
			// Re-lex the quote body with its marker line removed so the callout's
			// contents render as normal Markdown inside the styled box.
			const body = this.parser.parse(marked.lexer(token.text.slice(m[0].length)));
			return (
				`<div class="markdown-alert markdown-alert-${type}">` +
				`<p class="markdown-alert-title"><span class="markdown-alert-icon"></span>${ALERT_TITLES[type]}</p>` +
				`${body}</div>\n`
			);
		}
	}
});

// GitHub renders leading YAML frontmatter — a `---` fenced block at the very
// top of the file — as a borderless key/value table above the document body,
// instead of letting the closing `---` parse as a setext heading. We mirror
// that: pull the frontmatter off, render its `key: value` lines as a table, and
// hand the rest to `marked`.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function stripQuotes(s: string): string {
	const t = s.trim();
	if (
		t.length >= 2 &&
		((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
	) {
		return t.slice(1, -1);
	}
	return t;
}

// Pull leading frontmatter into flat key/value rows and return the remaining
// Markdown body. Only handles the simple `key: value` lines that frontmatter
// (e.g. changesets) uses; returns null when there's no frontmatter or no
// parseable rows, in which case the source is rendered as plain Markdown.
function extractFrontmatter(
	src: string
): { rows: { key: string; value: string }[]; body: string } | null {
	const m = FRONTMATTER_RE.exec(src);
	if (!m) return null;
	const rows: { key: string; value: string }[] = [];
	for (const rawLine of m[1].split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const idx = line.indexOf(':');
		if (idx === -1) continue;
		rows.push({ key: stripQuotes(line.slice(0, idx)), value: stripQuotes(line.slice(idx + 1)) });
	}
	if (rows.length === 0) return null;
	return { rows, body: src.slice(m[0].length) };
}

function frontmatterTableHtml(rows: { key: string; value: string }[]): string {
	const body = rows
		.map((r) => `<tr><th>${escapeHtml(r.key)}</th><td>${escapeHtml(r.value)}</td></tr>`)
		.join('');
	return `<table class="markdown-frontmatter"><tbody>${body}</tbody></table>\n`;
}

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
// Flip the Nth GFM task-list checkbox in `src` to `checked`, returning the new
// markdown. Matches `- [ ]` / `* [x]` / `1. [ ]` item markers in document order —
// the same order the rendered checkboxes appear — so `index` lines up with the
// clicked input. Returns `src` unchanged when `index` is out of range.
export function toggleTaskListItem(src: string, index: number, checked: boolean): string {
	let n = -1;
	return src.replace(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\])/gm, (m, pre, _mark, post) => {
		n++;
		if (n !== index) return m;
		return `${pre}${checked ? 'x' : ' '}${post}`;
	});
}

export async function renderMarkdown(src: string, theme: 'light' | 'dark'): Promise<string> {
	currentShikiTheme = theme === 'dark' ? 'github-dark' : 'github-light';
	const fm = extractFrontmatter(src);
	const html = (await marked.parse(fm ? fm.body : src, { async: true })) as string;
	const combined = (fm ? frontmatterTableHtml(fm.rows) : '') + html;
	return DOMPurify.sanitize(combined, { USE_PROFILES: { html: true } });
}
