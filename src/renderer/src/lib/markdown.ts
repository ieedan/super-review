// GitHub-Flavored-Markdown renderer used by the file Preview toggle. `marked`
// ships GFM support (tables, strikethrough, task lists, autolinks) on by
// default, so the rendered output mirrors how GitHub displays a `.md` file.
// The HTML is sanitized with DOMPurify before it reaches `{@html}` — repo
// contents are untrusted (often agent-written), and this runs in the Electron
// renderer where an injected script would be dangerous.
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  // GitHub doesn't turn a single newline into a <br> for regular `.md` files,
  // so leave `breaks` off to match its rendering.
  breaks: false,
});

// Force links to open in a new context and strip referrer/opener, and never
// let a `javascript:` URL slip through (DOMPurify drops those too).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const FILE_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn']);

/** True when the path's extension is a Markdown one we can preview. */
export function isMarkdownPath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return FILE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

/** Render Markdown source to sanitized, GFM-compatible HTML. */
export function renderMarkdown(src: string): string {
  const html = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
