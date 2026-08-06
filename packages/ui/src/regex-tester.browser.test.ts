import { describe, it, expect, afterEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './test/DiffFindHarness.svelte';
import { closeRegexTester, regexTester } from '@super-review/ui/regex-tester.svelte';
import type { DiffData } from '@super-review/core/types';

// These run in a REAL browser (Playwright/Chromium) because the tester's whole
// job is glue: Pierre's token events fire from inside a shadow root, the popup
// is portaled by bits-ui, and the anchor is measured from live rects. None of
// that exists in jsdom. The detection and evaluation logic underneath is covered
// by the fast Node tests in regex-scan-*.test.ts / regex-match.test.ts.

// An all-additions .ts file, so Pierre's render and the diff cache agree and
// every literal below lands on screen.
function fixture(lines: string[], path = 'src/lib/validators.ts'): DiffData {
	const newContents = lines.join('\n') + '\n';
	const patch = `@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => '+' + l).join('\n') + '\n';
	return {
		file: { path, status: 'added', additions: lines.length, deletions: 0, isBinary: false },
		patch,
		oldContents: '',
		newContents,
		truncated: false
	} as DiffData;
}

// Column offsets are quoted per line below because that's what the tests click.
//   line 1: `export const SEMVER = /^\d+\.\d+$/;`  literal at 22, `\d` token at 24
//   line 2: `export const BROKEN = /(unclosed/;`   literal at 22
//   line 4: `\treturn w / h;`                      the division `/` at 10
const LINES = [
	'export const SEMVER = /^\\d+\\.\\d+$/;',
	'export const BROKEN = /(unclosed/;',
	'export function aspect(w, h) {',
	'\treturn w / h;',
	'}'
];

// Every token Pierre rendered, across all the shadow roots on the page. Shiki
// splits a literal into one element per syntactic piece (`/`, `^`, `\d`, `+`,
// …), each tagged with its start offset in the line, which is exactly the
// fragmentation the tester has to see through.
function tokens(): HTMLElement[] {
	const out: HTMLElement[] = [];
	for (const host of document.querySelectorAll('*')) {
		const root = (host as HTMLElement).shadowRoot;
		if (!root) continue;
		out.push(...root.querySelectorAll<HTMLElement>('[data-char]'));
	}
	return out;
}

// The rendered token starting at `char` on the line whose text contains
// `lineText`. Waits for Pierre's async highlight pass to land.
async function tokenAt(lineText: string, char: number): Promise<HTMLElement> {
	let found: HTMLElement | undefined;
	await expect
		.poll(
			() =>
				(found = tokens().find(
					(t) =>
						t.getAttribute('data-char') === String(char) &&
						(t.closest('[data-line]')?.textContent ?? '').includes(lineText)
				)),
			{ timeout: 5000 }
		)
		.toBeTruthy();
	return found as HTMLElement;
}

// The rendered token whose own text contains `tokenText`, for the cases where
// the exact column is incidental to what is being asserted.
//
// Excludes a token that spans its whole line, which is what Pierre's first,
// pre-highlight paint emits: that token deliberately does NOT resolve to a regex
// (see `tokenBelongsToLiteral`), so matching it would just race the highlighter
// and fail. Waiting it out is the point.
async function tokenContaining(tokenText: string): Promise<HTMLElement> {
	let found: HTMLElement | undefined;
	await expect
		.poll(
			() =>
				(found = tokens().find((t) => {
					const text = t.textContent ?? '';
					if (!text.includes(tokenText)) return false;
					return text !== (t.closest('[data-line]')?.textContent ?? '');
				})),
			{ timeout: 5000 }
		)
		.toBeTruthy();
	return found as HTMLElement;
}

// Pierre listens for `pointermove` on the shadow root and resolves the token
// from the event's composed path, so a composed event on the token itself is
// exactly what a real hover delivers. It ignores anything that isn't a mouse,
// hence the explicit pointerType.
const POINTER = { bubbles: true, composed: true, pointerType: 'mouse' };

function hover(el: HTMLElement): void {
	el.dispatchEvent(new PointerEvent('pointermove', POINTER));
}

function click(el: HTMLElement): void {
	el.dispatchEvent(new PointerEvent('pointerdown', POINTER));
	el.dispatchEvent(new PointerEvent('pointerup', POINTER));
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
}

// The popup is portaled to the body, so it's found by its own landmarks rather
// than through the diff.
function popupInput(): HTMLInputElement | null {
	return document.querySelector<HTMLInputElement>('input[aria-label="Test string"]');
}

function card(): Element | null {
	return popupInput()?.closest('[data-slot="popover-content"]') ?? null;
}

// The verdict block, absent entirely until there is something to report.
function statusText(): string {
	return card()?.querySelector('[role="status"]')?.textContent?.trim() ?? '';
}

async function type(value: string): Promise<void> {
	const input = popupInput();
	if (!input) throw new Error('the tester is not open');
	input.focus();
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	// The popup settles the value on a short timer before evaluating.
	await new Promise((resolve) => setTimeout(resolve, 80));
}

afterEach(() => {
	closeRegexTester();
	document.body.innerHTML = '';
});

describe('regex tester in the diff', () => {
	it('hints on hover and opens the tester on click', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		const token = await tokenAt('SEMVER', 24);

		hover(token);
		// The hint waits out the hover-intent delay rather than firing instantly.
		expect(regexTester.hintArmed).toBe(false);
		await expect.poll(() => regexTester.hintArmed, { timeout: 2000 }).toBe(true);
		await expect.poll(() => document.body.textContent).toContain('Test regex');

		click(token);
		await expect.poll(() => popupInput()).toBeTruthy();
		// Hovering one fragment (`\d`) identifies the whole literal, not the piece
		// under the pointer.
		expect(regexTester.openTarget?.source).toBe('/^\\d+\\.\\d+$/');
		// Opening the tester retires the hint.
		expect(regexTester.hintArmed).toBe(false);
	});

	it('opens from any fragment of the literal, including its slashes', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		// The opening `/` of the SEMVER literal.
		click(await tokenAt('SEMVER', 22));
		await expect.poll(() => regexTester.openTarget?.source).toBe('/^\\d+\\.\\d+$/');
	});

	it('focuses the input on open', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		click(await tokenAt('SEMVER', 24));
		await expect.poll(() => popupInput()).toBeTruthy();
		await expect.poll(() => document.activeElement === popupInput()).toBe(true);
	});

	it('evaluates the test string live', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		click(await tokenAt('SEMVER', 24));
		await expect.poll(() => popupInput()).toBeTruthy();

		// Nothing typed yet: no verdict block at all, so the popup is just an input.
		expect(card()?.querySelector('[role="status"]')).toBeNull();

		await type('1.4');
		expect(statusText()).toContain('Match');
		// What matched is spelled out under the verdict.
		expect(statusText()).toContain('1.4');

		await type('nope');
		expect(statusText()).toContain('No match');
	});

	it('highlights the matched runs behind the input', async () => {
		render(Harness, { fixtures: [fixture(['export const DIGITS = /\\d+/g;'])] });
		click(await tokenAt('DIGITS', 22));
		await expect.poll(() => popupInput()).toBeTruthy();

		await type('a12b345');
		// A global literal highlights every match, and the backdrop reassembles the
		// typed string exactly (or the highlight would drift from the caret).
		const backdrop = card()?.querySelector('.regex-backdrop');
		expect([...(backdrop?.querySelectorAll('mark') ?? [])].map((m) => m.textContent)).toEqual([
			'12',
			'345'
		]);
		expect(backdrop?.textContent).toBe('a12b345');
		expect(statusText()).toContain('2 matches');
	});

	it('reports a literal that does not compile', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		click(await tokenAt('BROKEN', 22));
		await expect.poll(() => popupInput()).toBeTruthy();
		expect(regexTester.openTarget?.source).toBe('/(unclosed/');
		// The engine's own message, shown without waiting for a test string.
		expect(statusText().toLowerCase()).toContain('group');
	});

	it('ignores a slash that is division, not a regex', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		// Shiki leaves this line as one token, so this is the whole statement.
		const division = await tokenAt('return w', 1);
		expect(division.textContent).toContain('w / h');

		hover(division);
		// Well past the hover-intent delay: nothing should arm.
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(regexTester.hintArmed).toBe(false);

		click(division);
		expect(popupInput()).toBeNull();
	});

	it('closes on Escape, and reopens on the same literal', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		const token = await tokenAt('SEMVER', 24);
		click(token);
		await expect.poll(() => popupInput()).toBeTruthy();

		popupInput()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await expect.poll(() => popupInput()).toBeNull();

		click(token);
		await expect.poll(() => popupInput()).toBeTruthy();
	});

	it('closes when the same literal is clicked again', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		const token = await tokenAt('SEMVER', 24);
		click(token);
		await expect.poll(() => popupInput()).toBeTruthy();
		click(token);
		await expect.poll(() => popupInput()).toBeNull();
	});

	it('retargets to another literal, with a fresh test string', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		click(await tokenAt('SEMVER', 24));
		await expect.poll(() => popupInput()).toBeTruthy();
		await type('1.4');
		expect(statusText()).toContain('Match');

		click(await tokenAt('BROKEN', 22));
		await expect.poll(() => regexTester.openTarget?.source).toBe('/(unclosed/');
		// Test strings don't carry over between literals.
		expect(popupInput()?.value).toBe('');
	});

	it('finds a regex in a C# file, where regexes are strings', async () => {
		// A verbatim string handed to a target-typed `new`, which is how the .NET
		// code that prompted C# support writes them: the `Regex` type is on the
		// declaration, not the expression.
		render(Harness, {
			fixtures: [
				fixture(
					[
						'public static class ListSqlTrace {',
						'  private static readonly Regex ParameterPattern =',
						'    new(@"(?<!@)@([A-Za-z_][A-Za-z0-9_]*)", RegexOptions.Compiled);',
						'}'
					],
					'src/ListSqlTrace.cs'
				)
			]
		});

		click(await tokenContaining('[A-Za-z_]'));
		await expect.poll(() => popupInput()).toBeTruthy();
		// The pattern is the string's value: no `@"` wrapper, and nothing decoded
		// away, since a verbatim string keeps its backslashes.
		expect(regexTester.openTarget?.pattern).toBe('(?<!@)@([A-Za-z_][A-Za-z0-9_]*)');

		await type('select @name from t');
		expect(statusText()).toContain('Match');
		expect(statusText()).toContain('@name');
	});

	it('translates RegexOptions into RegExp flags', async () => {
		render(Harness, {
			fixtures: [
				fixture(['var re = new Regex("^ab$", RegexOptions.IgnoreCase);'], 'src/Options.cs')
			]
		});
		click(await tokenContaining('^ab$'));
		await expect.poll(() => regexTester.openTarget?.flags).toBe('i');
		await type('AB');
		expect(statusText()).toContain('Match');
	});

	it('leaves an ordinary C# string alone', async () => {
		render(Harness, {
			fixtures: [
				fixture(
					['public class A {', '  private const string Key = "__chorus_list_sql";', '}'],
					'src/A.cs'
				)
			]
		});
		const token = await tokenContaining('__chorus_list_sql');

		hover(token);
		// Well past the hover-intent delay: a string that isn't in a Regex position
		// must stay inert, or every string in a C# file would look testable.
		await new Promise((resolve) => setTimeout(resolve, 600));
		expect(regexTester.hintArmed).toBe(false);

		click(token);
		expect(popupInput()).toBeNull();
	});

	it('drops the hint when the pointer moves to a token that is not a literal', async () => {
		render(Harness, { fixtures: [fixture(LINES)] });
		hover(await tokenAt('SEMVER', 24));
		await expect.poll(() => regexTester.hintArmed, { timeout: 2000 }).toBe(true);

		// `SEMVER` itself, on the same line but outside the literal.
		hover(await tokenAt('SEMVER', 13));
		await expect.poll(() => regexTester.hintArmed).toBe(false);
	});
});
