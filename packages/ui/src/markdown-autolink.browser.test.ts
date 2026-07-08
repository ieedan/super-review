import { describe, it, expect, afterEach } from 'vitest';
import { renderMarkdown, setMarkdownRepoContext } from '@super-review/ui/markdown';
import { getCarta } from '@super-review/ui/carta';

// renderMarkdown sanitizes with DOMPurify, which needs a real DOM, so this runs
// in the browser project (not the Node unit project). It exercises the GitHub
// `#issue` / `@mention` autolinking added to the markdown renderer.

afterEach(() => setMarkdownRepoContext(null));

describe('GitHub reference autolinking', () => {
	it('links #123 to the repo issue/PR when a repo context is set', async () => {
		setMarkdownRepoContext({ owner: 'octocat', repo: 'hello' });
		const html = await renderMarkdown('Fixes #2748', 'light');
		expect(html).toContain('href="https://github.com/octocat/hello/issues/2748"');
		expect(html).toContain('>#2748</a>');
	});

	it('links @user to their GitHub profile with an inline avatar', async () => {
		setMarkdownRepoContext({ owner: 'octocat', repo: 'hello' });
		const html = await renderMarkdown('cc @octocat', 'light');
		expect(html).toContain('href="https://github.com/octocat"');
		expect(html).toContain('>@octocat</a>');
		expect(html).toContain('src="https://github.com/octocat.png');
		expect(html).toContain('gh-mention-avatar');
	});

	it('leaves references literal when no repo context is set', async () => {
		const html = await renderMarkdown('Fixes #2748 cc @octocat', 'light');
		expect(html).not.toContain('<a');
		expect(html).toContain('#2748');
		expect(html).toContain('@octocat');
	});

	it('does not link inside a word or a non-issue #', async () => {
		setMarkdownRepoContext({ owner: 'octocat', repo: 'hello' });
		// `C#5` (word before #), `#fff` (no digit), and an email's local part must not
		// become a reference/mention. (GFM still autolinks the email as `mailto:`,
		// which is expected — we only assert nothing turns into a github.com link.)
		const html = await renderMarkdown('Use C#5 and color #fff and mail foo@bar.com', 'light');
		expect(html).not.toContain('github.com');
	});

	it('does not link references inside inline code', async () => {
		setMarkdownRepoContext({ owner: 'octocat', repo: 'hello' });
		const html = await renderMarkdown('literal `#2748` and `@octocat`', 'light');
		expect(html).not.toContain('<a');
	});
});

// The composer's Write/Preview tab renders through Carta's remark pipeline, not
// renderMarkdown, so the autolinking is added there separately (carta.ts). This
// exercises that path via carta.render directly.
describe('Carta preview autolinking', () => {
	it('links #146 and @octocat in the Carta preview', async () => {
		setMarkdownRepoContext({ owner: 'octocat', repo: 'hello' });
		const html = await getCarta('pierre').render('#146 cc @octocat');
		expect(html).toContain('href="https://github.com/octocat/hello/issues/146"');
		expect(html).toContain('href="https://github.com/octocat"');
		// The mention carries its inline avatar in the preview too.
		expect(html).toContain('src="https://github.com/octocat.png');
		expect(html).toContain('gh-mention-avatar');
	});

	it('leaves refs literal in the Carta preview with no repo context', async () => {
		const html = await getCarta('pierre').render('#146 cc @octocat');
		expect(html).not.toContain('github.com');
	});

	it('does not link a ref inside inline code in the Carta preview', async () => {
		setMarkdownRepoContext({ owner: 'octocat', repo: 'hello' });
		const html = await getCarta('pierre').render('`#146`');
		expect(html).not.toContain('<a');
	});
});
