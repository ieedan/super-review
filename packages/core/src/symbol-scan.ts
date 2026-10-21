// A small, dependency-free scanner for JavaScript, TypeScript and Svelte that
// answers one question per identifier: is this occurrence a real *reference* to a
// name, or is it something that merely spells the same (a comment, a string, a
// property key, a member access, a parameter that shadows it, ...)? That is what
// the "used in N places" lens needs, and nothing more: there is no AST, no scope
// tree and no type information.
//
// It is hand-rolled rather than a real parser for the same reason the other
// scanners here are (regex-scan-js.ts, package-json-deps.ts): a working-tree file
// may not parse at all, and we only need source positions. The price is that
// accuracy comes from conservative rules rather than semantics:
//
//   * Occurrences inside comments, strings and regex literals never count.
//   * `obj.name`, `{ name: 1 }`, class/enum/interface members and import/export
//     specifiers are not references to a top-level `name`.
//   * A *binding* of the same name somewhere else in the file (a parameter, a
//     nested `const`, a catch clause, an `{#each}` item) is recorded as a shadow,
//     so callers can mark the count approximate instead of claiming it is exact.
//
// The scanner never decides what an occurrence resolves to across files. It only
// reports what is in one file; symbol-refs.ts joins files through their imports.

export type TokKind = 'id' | 'punct' | 'str' | 'num';

export interface Tok {
	kind: TokKind;
	// Identifier name, punctuator text, or (for strings) the unquoted contents.
	text: string;
	start: number;
	end: number;
	// 1-based line and 0-based column of the token's first character.
	line: number;
	col: number;
}

export type DeclKind =
	| 'function'
	| 'class'
	| 'interface'
	| 'type'
	| 'enum'
	| 'const'
	| 'let'
	| 'var';

export interface Decl {
	name: string;
	kind: DeclKind;
	// Line of the declaration's first token (`export`, `async`, `function`, ...),
	// which is where a code lens belongs.
	line: number;
	nameLine: number;
	nameCol: number;
	// `export`ed under its own name.
	exported: boolean;
	// `export default function foo() {}`: importable only as `default`.
	isDefault: boolean;
	// `const f = () => ...` / `= function ...`: a function in everything but syntax.
	functionLike: boolean;
	// Declared in a Svelte component's instance `<script>`, where `export` means
	// "this is a prop", which parents set without ever importing the name.
	componentProp: boolean;
	// Declared in a Svelte instance script (as opposed to a module or plain file).
	svelteInstance: boolean;
}

export interface Occurrence {
	name: string;
	start: number;
	line: number;
	col: number;
	// `obj.name`: the property is not a reference to a top-level binding. The
	// receiver is kept so `ns.name` can be matched against namespace imports.
	member: boolean;
	obj: string | null;
	// For a plain reference followed by `.prop`: that `prop`. Lets the caller see
	// whether a namespace import is only ever accessed by name.
	access: string | null;
}

export interface ImportBinding {
	kind: 'named' | 'default' | 'namespace';
	// The name on the exporting side (`default` for a default import, `*` for a
	// namespace import).
	imported: string;
	local: string;
	typeOnly: boolean;
}

export interface ImportRecord {
	source: string;
	bindings: ImportBinding[];
}

export interface ReexportItem {
	imported: string;
	exported: string;
	start: number;
	line: number;
	col: number;
}

export interface ReexportRecord {
	source: string;
	kind: 'named' | 'star' | 'starAs';
	items: ReexportItem[];
	// `export * as ns from`: the namespace name.
	nsName?: string;
}

export interface LocalExport {
	local: string;
	exported: string;
	start: number;
	line: number;
	col: number;
}

export interface DynamicRef {
	// The literal module specifier, or null when it is computed.
	source: string | null;
	via: 'import' | 'require';
}

export interface FileScan {
	decls: Decl[];
	// `export { a as b }` (no `from`) and `export default a`. Positioned so a
	// re-export of an imported binding can be reported as a use of it.
	localExports: LocalExport[];
	imports: ImportRecord[];
	reexports: ReexportRecord[];
	dynamic: DynamicRef[];
	occurrences: Occurrence[];
	// Names bound somewhere other than the module's top level: the shadow set.
	shadows: Set<string>;
	// Every name declared at module top level (any kind, including destructured).
	topLevel: Set<string>;
}

// ---------------------------------------------------------------------------
// Lexing
// ---------------------------------------------------------------------------

// After these, a `/` starts a regex rather than dividing.
const REGEX_PRECEDING_KEYWORDS = new Set([
	'await',
	'case',
	'delete',
	'do',
	'else',
	'in',
	'instanceof',
	'new',
	'of',
	'return',
	'throw',
	'typeof',
	'void',
	'yield'
]);

// Keywords whose parenthesised head is followed by a statement, so the `)` that
// closes one does not end an expression (`if (ok) /re/.test(s)`).
const CONTROL_HEADS = new Set(['if', 'while', 'for', 'switch', 'with']);

// Longest first so `>>>=` wins over `>>`.
const MULTI_PUNCT = [
	'>>>=',
	'...',
	'===',
	'!==',
	'**=',
	'<<=',
	'>>=',
	'>>>',
	'&&=',
	'||=',
	'??=',
	'=>',
	'==',
	'!=',
	'<=',
	'>=',
	'&&',
	'||',
	'??',
	'?.',
	'++',
	'--',
	'+=',
	'-=',
	'*=',
	'/=',
	'%=',
	'&=',
	'|=',
	'^=',
	'**',
	'<<',
	'>>'
];

function isIdStart(ch: string): boolean {
	return (
		(ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$' || ch > '\x7f'
	);
}

function isIdPart(ch: string): boolean {
	return isIdStart(ch) || (ch >= '0' && ch <= '9');
}

function isDigit(ch: string): boolean {
	return ch >= '0' && ch <= '9';
}

export function buildLineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === 10) starts.push(i + 1);
	}
	return starts;
}

// 1-based line containing `offset`.
function lineAt(starts: number[], offset: number): number {
	let lo = 0;
	let hi = starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (starts[mid] <= offset) lo = mid;
		else hi = mid - 1;
	}
	return lo + 1;
}

interface LexResult {
	tokens: Tok[];
	// Offset just past what was lexed. With `stopAtCloseBrace`, just past the
	// closing `}`.
	end: number;
}

// Tokenize `text[from, to)`. Strings, template text, comments and regex literals
// are consumed (strings and templates leave a `str` token behind so an adjacent
// `/` is read as division); everything else becomes an id / num / punct token.
function lex(
	text: string,
	from: number,
	to: number,
	starts: number[],
	stopAtCloseBrace: boolean
): LexResult {
	const tokens: Tok[] = [];
	let i = from;
	let line = lineAt(starts, from);
	let lineStart = starts[line - 1];

	let braceDepth = 0;
	// Brace depths at which a `${` is open, innermost last.
	const templateBraces: number[] = [];
	// Per open `(`: whether it follows a control keyword.
	const parenIsControl: boolean[] = [];
	let prevIsValue = false;

	const push = (kind: TokKind, tokText: string, start: number, end: number): void => {
		tokens.push({ kind, text: tokText, start, end, line, col: start - lineStart });
	};

	// Consume template text from `i` up to the closing backtick or a `${`.
	const scanTemplateChunk = (): void => {
		const chunkStart = i;
		const startLine = line;
		const startCol = chunkStart - lineStart;
		while (i < to) {
			const ch = text[i];
			if (ch === '\\') {
				if (text[i + 1] === '\n') {
					line++;
					lineStart = i + 2;
				}
				i += 2;
				continue;
			}
			if (ch === '\n') {
				line++;
				lineStart = i + 1;
				i++;
				continue;
			}
			if (ch === '`') {
				tokens.push({
					kind: 'str',
					text: '',
					start: chunkStart,
					end: i + 1,
					line: startLine,
					col: startCol
				});
				i++;
				prevIsValue = true;
				return;
			}
			if (ch === '$' && text[i + 1] === '{') {
				tokens.push({
					kind: 'str',
					text: '',
					start: chunkStart,
					end: i,
					line: startLine,
					col: startCol
				});
				push('punct', '${', i, i + 2);
				i += 2;
				braceDepth++;
				templateBraces.push(braceDepth);
				prevIsValue = false;
				return;
			}
			i++;
		}
	};

	while (i < to) {
		const ch = text[i];

		if (ch === '\n') {
			line++;
			lineStart = i + 1;
			i++;
			continue;
		}
		if (ch === ' ' || ch === '\t' || ch === '\r') {
			i++;
			continue;
		}

		// Comments.
		if (ch === '/' && text[i + 1] === '/') {
			while (i < to && text[i] !== '\n') i++;
			continue;
		}
		if (ch === '/' && text[i + 1] === '*') {
			i += 2;
			while (i < to && !(text[i] === '*' && text[i + 1] === '/')) {
				if (text[i] === '\n') {
					line++;
					lineStart = i + 1;
				}
				i++;
			}
			i += 2;
			continue;
		}

		// Strings.
		if (ch === '"' || ch === "'") {
			const start = i;
			const startLine = line;
			const startCol = start - lineStart;
			i++;
			while (i < to && text[i] !== ch && text[i] !== '\n') {
				if (text[i] === '\\') {
					if (text[i + 1] === '\n') {
						line++;
						lineStart = i + 2;
					}
					i++;
				}
				i++;
			}
			const value = text.slice(start + 1, Math.min(i, to));
			if (text[i] === ch) i++;
			tokens.push({
				kind: 'str',
				text: value,
				start,
				end: i,
				line: startLine,
				col: startCol
			});
			prevIsValue = true;
			continue;
		}

		if (ch === '`') {
			i++;
			scanTemplateChunk();
			continue;
		}

		// Identifiers (and `#private` names).
		if (isIdStart(ch) || (ch === '#' && isIdStart(text[i + 1] ?? ''))) {
			const start = i;
			i++;
			while (i < to && isIdPart(text[i])) i++;
			const name = text.slice(start, i);
			push('id', name, start, i);
			prevIsValue = !REGEX_PRECEDING_KEYWORDS.has(name);
			continue;
		}

		// Numbers.
		if (isDigit(ch) || (ch === '.' && isDigit(text[i + 1] ?? ''))) {
			const start = i;
			i++;
			while (i < to) {
				const c = text[i];
				if (isIdPart(c)) {
					i++;
				} else if (c === '.' && isDigit(text[i + 1] ?? '')) {
					i++;
				} else if (
					(c === '+' || c === '-') &&
					/[eE]/.test(text[i - 1]) &&
					!/^0[xX]/.test(text.slice(start, i))
				) {
					i++;
				} else break;
			}
			push('num', text.slice(start, i), start, i);
			prevIsValue = true;
			continue;
		}

		// A `/` that is not division starts a regex literal.
		if (ch === '/' && !prevIsValue) {
			const start = i;
			let j = i + 1;
			let inClass = false;
			let closed = false;
			while (j < to && text[j] !== '\n') {
				const c = text[j];
				if (c === '\\') {
					j += 2;
					continue;
				}
				if (c === '[') inClass = true;
				else if (c === ']') inClass = false;
				else if (c === '/' && !inClass) {
					closed = true;
					break;
				}
				j++;
			}
			if (closed) {
				j++;
				while (j < to && /[a-z]/.test(text[j])) j++;
				push('str', '', start, j);
				i = j;
				prevIsValue = true;
				continue;
			}
			// Not a regex after all; fall through to a plain `/`.
		}

		// Punctuation.
		if (ch === '}') {
			if (templateBraces.length > 0 && templateBraces[templateBraces.length - 1] === braceDepth) {
				templateBraces.pop();
				braceDepth--;
				push('punct', '}', i, i + 1);
				i++;
				scanTemplateChunk();
				continue;
			}
			if (stopAtCloseBrace && braceDepth === 0) {
				return { tokens, end: i + 1 };
			}
			braceDepth--;
			push('punct', '}', i, i + 1);
			i++;
			prevIsValue = false;
			continue;
		}
		if (ch === '{') {
			braceDepth++;
			push('punct', '{', i, i + 1);
			i++;
			prevIsValue = false;
			continue;
		}
		if (ch === '(') {
			const prev = tokens[tokens.length - 1];
			parenIsControl.push(prev?.kind === 'id' && CONTROL_HEADS.has(prev.text));
			push('punct', '(', i, i + 1);
			i++;
			prevIsValue = false;
			continue;
		}
		if (ch === ')') {
			const wasControl = parenIsControl.pop() ?? false;
			push('punct', ')', i, i + 1);
			i++;
			prevIsValue = !wasControl;
			continue;
		}
		if (ch === ']') {
			push('punct', ']', i, i + 1);
			i++;
			prevIsValue = true;
			continue;
		}

		let matched: string | null = null;
		for (const p of MULTI_PUNCT) {
			if (text.startsWith(p, i)) {
				matched = p;
				break;
			}
		}
		// `?.` followed by a digit is a ternary (`a?.5:1`), not optional chaining.
		if (matched === '?.' && isDigit(text[i + 2] ?? '')) matched = null;
		const p = matched ?? ch;
		push('punct', p, i, i + p.length);
		i += p.length;
		prevIsValue = false;
	}

	return { tokens, end: to };
}

// ---------------------------------------------------------------------------
// Svelte
// ---------------------------------------------------------------------------

interface SvelteScript {
	from: number;
	to: number;
	module: boolean;
}

interface SvelteLayout {
	scripts: SvelteScript[];
	// Template regions: everything outside `<script>` and `<style>`.
	markup: [number, number][];
}

function splitSvelte(text: string): SvelteLayout {
	const scripts: SvelteScript[] = [];
	const cuts: [number, number][] = [];
	const re = /<(script|style)\b([^>]*)>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const tag = m[1];
		const contentStart = m.index + m[0].length;
		// A self-closing `<script />` has no body.
		if (m[2].trimEnd().endsWith('/')) {
			cuts.push([m.index, contentStart]);
			continue;
		}
		const close = text.indexOf(`</${tag}`, contentStart);
		const contentEnd = close < 0 ? text.length : close;
		const closeEnd = close < 0 ? text.length : text.indexOf('>', close) + 1 || text.length;
		if (tag === 'script') {
			const attrs = m[2];
			scripts.push({
				from: contentStart,
				to: contentEnd,
				module: /\bmodule\b|context\s*=\s*["']module["']/.test(attrs)
			});
		}
		cuts.push([m.index, closeEnd]);
		re.lastIndex = closeEnd;
	}
	const markup: [number, number][] = [];
	let cursor = 0;
	for (const [a, b] of cuts) {
		if (a > cursor) markup.push([cursor, a]);
		cursor = Math.max(cursor, b);
	}
	if (cursor < text.length) markup.push([cursor, text.length]);
	return { scripts, markup };
}

const DIRECTIVES_NAMING_A_FUNCTION = new Set(['use', 'transition', 'in', 'out', 'animate']);
const DIRECTIVES_SHORTHAND_VARIABLE = new Set(['bind', 'class', 'style']);

// A template segment: either one `{...}` expression or a single name that sits
// outside braces (a component tag or a directive like `use:action`).
interface Segment {
	tokens: Tok[];
	markup: boolean;
	// Svelte instance script (`<script>` without `module`).
	svelteInstance: boolean;
	// For a block tag like `{#each a as b}`: the head word (`each`). The tokens
	// start after it, so the sigil and keyword never reach the classifier.
	head?: string;
}

function scanMarkup(
	text: string,
	from: number,
	to: number,
	starts: number[],
	out: Segment[]
): void {
	let i = from;

	const nameToken = (name: string, start: number): Tok => {
		const line = lineAt(starts, start);
		return {
			kind: 'id',
			text: name,
			start,
			end: start + name.length,
			line,
			col: start - starts[line - 1]
		};
	};
	// A name outside braces: a component tag or a directive. A dotted path
	// (`Filters.Root`) becomes `Filters . Root` so the classifier sees the
	// property access and a namespace import used this way is not mistaken for
	// the namespace being used as a whole.
	const pushName = (path: string, start: number): void => {
		const tokens: Tok[] = [];
		let offset = 0;
		for (const part of path.split('.')) {
			if (offset > 0) {
				const line = lineAt(starts, start + offset - 1);
				tokens.push({
					kind: 'punct',
					text: '.',
					start: start + offset - 1,
					end: start + offset,
					line,
					col: start + offset - 1 - starts[line - 1]
				});
			}
			tokens.push(nameToken(part, start + offset));
			offset += part.length + 1;
		}
		out.push({ tokens, markup: true, svelteInstance: false });
	};
	const expression = (): void => {
		// `{/if}` closes a block: nothing inside it is code. Skipping it here also
		// keeps the lexer from reading the leading `/` as the start of a regex.
		if (text[i + 1] === '/') {
			const close = text.indexOf('}', i);
			i = close < 0 || close >= to ? to : close + 1;
			return;
		}
		// `{#each ...}`, `{:then v}`, `{@const x = 1}`: peel off the sigil and head
		// word and lex only the rest.
		const headMatch = /^[#:@]\s*([A-Za-z]+)/.exec(text.slice(i + 1, i + 24));
		let head: string | undefined;
		let bodyStart = i + 1;
		if (headMatch) {
			head = headMatch[1];
			bodyStart = i + 1 + headMatch[0].length;
		}
		const r = lex(text, bodyStart, to, starts, true);
		out.push({ tokens: r.tokens, markup: true, svelteInstance: false, head });
		i = r.end;
	};

	while (i < to) {
		const ch = text[i];
		if (ch === '{') {
			expression();
			continue;
		}
		if (ch !== '<') {
			i++;
			continue;
		}
		if (text.startsWith('<!--', i)) {
			const j = text.indexOf('-->', i + 4);
			i = j < 0 || j >= to ? to : j + 3;
			continue;
		}
		if (text[i + 1] === '/') {
			const j = text.indexOf('>', i);
			i = j < 0 || j >= to ? to : j + 1;
			continue;
		}
		const tag = /[A-Za-z][\w$.:-]*/y;
		tag.lastIndex = i + 1;
		const tm = tag.exec(text);
		if (!tm) {
			i++;
			continue;
		}
		const tagName = tm[0];
		const tagStart = i + 1;
		i = tagStart + tagName.length;
		// `<Foo.Bar>` references `Foo` (and reads its `Bar`); `<svelte:head>` and
		// plain elements name nothing in scope (a lowercase tag can't be a
		// component binding).
		if (!tagName.includes(':') && /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(tagName)) {
			pushName(tagName, tagStart);
		}
		// Attributes, up to the end of the tag.
		while (i < to) {
			while (i < to && /\s/.test(text[i])) i++;
			if (i >= to) break;
			if (text[i] === '>') {
				i++;
				break;
			}
			if (text[i] === '/' && text[i + 1] === '>') {
				i += 2;
				break;
			}
			if (text[i] === '{') {
				expression();
				continue;
			}
			const attr = /[^\s=>/{}]+/y;
			attr.lastIndex = i;
			const am = attr.exec(text);
			if (!am) {
				i++;
				continue;
			}
			const attrName = am[0];
			const attrStart = i;
			i += attrName.length;
			let afterName = i;
			while (afterName < to && /\s/.test(text[afterName])) afterName++;
			const hasValue = text[afterName] === '=';
			const colon = attrName.indexOf(':');
			if (colon > 0) {
				const prefix = attrName.slice(0, colon);
				const rest = attrName.slice(colon + 1).split('|')[0];
				if (/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(rest)) {
					if (DIRECTIVES_NAMING_A_FUNCTION.has(prefix)) {
						pushName(rest, attrStart + colon + 1);
					} else if (DIRECTIVES_SHORTHAND_VARIABLE.has(prefix) && !hasValue) {
						pushName(rest, attrStart + colon + 1);
					}
				}
			}
			if (!hasValue) continue;
			i = afterName + 1;
			while (i < to && /\s/.test(text[i])) i++;
			const q = text[i];
			if (q === '"' || q === "'") {
				i++;
				while (i < to && text[i] !== q) {
					if (text[i] === '{') expression();
					else i++;
				}
				i++;
			} else if (q === '{') {
				expression();
			} else {
				while (i < to && !/[\s>]/.test(text[i])) i++;
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

// What the analysis decided about one token.
const ROLE_REF = 0;
// Consumed by a statement parser (import/export specifier, a top-level
// declaration's own name): never a reference, never a shadow.
const ROLE_SKIP = 1;
// A binding introduced somewhere other than module top level (shadows).
const ROLE_BINDING = 2;
// An object key or a class/enum/interface member definition.
const ROLE_KEY = 3;

const MEMBER_MODIFIERS = new Set([
	'static',
	'public',
	'private',
	'protected',
	'readonly',
	'abstract',
	'async',
	'get',
	'set',
	'declare',
	'override',
	'accessor'
]);

const PARAM_PROPERTY_MODIFIERS = new Set([
	'public',
	'private',
	'protected',
	'readonly',
	'override'
]);

const STATEMENT_ENDERS = new Set([';', '}', ')', ']', '>']);

// Words that can never be a user symbol; dropping them keeps the occurrence list
// small without risking a missed reference.
const RESERVED = new Set([
	'break',
	'case',
	'catch',
	'continue',
	'debugger',
	'default',
	'delete',
	'do',
	'else',
	'export',
	'extends',
	'finally',
	'for',
	'function',
	'if',
	'import',
	'in',
	'instanceof',
	'new',
	'return',
	'switch',
	'this',
	'throw',
	'try',
	'typeof',
	'var',
	'void',
	'while',
	'with',
	'null',
	'true',
	'false'
]);

type BodyKind = 'class' | 'enum' | 'interface' | 'other';

interface Ctx {
	open: string;
	kind: BodyKind;
}

function isOpener(t: Tok | undefined): boolean {
	return (
		t !== undefined &&
		t.kind === 'punct' &&
		(t.text === '(' || t.text === '[' || t.text === '{' || t.text === '${')
	);
}

function isCloser(t: Tok): boolean {
	return t.kind === 'punct' && (t.text === ')' || t.text === ']' || t.text === '}');
}

// Index of each opener's closer (and vice versa); -1 when unmatched.
function matchBrackets(tokens: Tok[]): Int32Array {
	const match = new Int32Array(tokens.length).fill(-1);
	const stack: number[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (isOpener(t)) {
			stack.push(i);
		} else if (isCloser(t)) {
			const open = stack.pop();
			if (open !== undefined) {
				match[open] = i;
				match[i] = open;
			}
		}
	}
	return match;
}

interface Accumulator {
	scan: FileScan;
}

function pushOccurrence(acc: Accumulator, tokens: Tok[], i: number, member: boolean): void {
	const t = tokens[i];
	let obj: string | null = null;
	if (member) {
		const recv = tokens[i - 2];
		if (recv?.kind === 'id') obj = recv.text;
	}
	let access: string | null = null;
	if (!member) {
		const dot = tokens[i + 1];
		const prop = tokens[i + 2];
		if (dot?.kind === 'punct' && (dot.text === '.' || dot.text === '?.') && prop?.kind === 'id') {
			access = prop.text;
		}
	}
	acc.scan.occurrences.push({
		name: t.text,
		start: t.start,
		line: t.line,
		col: t.col,
		member,
		obj,
		access
	});
}

// Analyze one token run. `markup` runs (Svelte template expressions) skip the
// statement-level parsers, since nothing in a template is a declaration or an
// import.
function analyzeSegment(seg: Segment, acc: Accumulator): void {
	const tokens = seg.tokens;
	if (tokens.length === 0) return;
	const match = matchBrackets(tokens);
	const role = new Uint8Array(tokens.length);
	const { scan } = acc;
	const markup = seg.markup;

	const text = (k: number): string => tokens[k]?.text ?? '';
	const isPunct = (k: number, s: string): boolean => {
		const t = tokens[k];
		return t !== undefined && t.kind === 'punct' && t.text === s;
	};
	const isId = (k: number, s?: string): boolean => {
		const t = tokens[k];
		return t !== undefined && t.kind === 'id' && (s === undefined || t.text === s);
	};

	// Whether the statement beginning at `first` really starts a statement (as
	// opposed to sitting in the middle of an expression, like `x = function f`).
	const atStatementStart = (first: number): boolean => {
		const p = tokens[first - 1];
		if (!p) return true;
		if (p.kind === 'punct') {
			if (p.text === ';' || p.text === '}') return true;
			return STATEMENT_ENDERS.has(p.text) && p.line < tokens[first].line;
		}
		// ASI: the previous statement ended at a line break.
		return p.line < tokens[first].line;
	};

	// Walk back over modifiers to find where a declaration begins and whether it
	// is exported / default.
	const declPrefix = (kw: number): { first: number; exported: boolean; isDefault: boolean } => {
		let first = kw;
		let exported = false;
		let isDefault = false;
		for (let j = kw - 1; j >= 0; j--) {
			const t = tokens[j];
			if (t.kind !== 'id') break;
			if (t.text === 'export') {
				exported = true;
				first = j;
				break;
			}
			if (t.text === 'default') {
				isDefault = true;
				first = j;
				continue;
			}
			if (
				t.text === 'declare' ||
				t.text === 'abstract' ||
				t.text === 'async' ||
				t.text === 'const'
			) {
				first = j;
				continue;
			}
			break;
		}
		return { first, exported, isDefault };
	};

	// Mark every binding in the pattern starting at `i` (an identifier, `{...}` or
	// `[...]`), appending the identifier indices to `out`. Returns the index after
	// the pattern. Default values and type annotations are left alone so the main
	// pass still sees the references inside them.
	const markPattern = (i: number, out: number[]): number => {
		const t = tokens[i];
		if (!t) return i;
		if (t.kind === 'id') {
			out.push(i);
			return i + 1;
		}
		if ((t.text === '{' || t.text === '[') && match[i] > i) {
			const close = match[i];
			let j = i + 1;
			while (j < close) {
				const tj = tokens[j];
				if (tj.kind === 'punct' && tj.text === '...') {
					j++;
					continue;
				}
				if (tj.kind === 'id') {
					if (t.text === '{' && isPunct(j + 1, ':')) {
						role[j] = ROLE_KEY;
						j = markPattern(j + 2, out);
					} else {
						out.push(j);
						j++;
					}
					if (isPunct(j, '=')) {
						j++;
						while (j < close && !isPunct(j, ','))
							j = isOpener(tokens[j]) && match[j] > j ? match[j] + 1 : j + 1;
					}
					continue;
				}
				if ((tj.text === '{' || tj.text === '[') && match[j] > j) {
					j = markPattern(j, out);
					if (isPunct(j, '=')) {
						j++;
						while (j < close && !isPunct(j, ','))
							j = isOpener(tokens[j]) && match[j] > j ? match[j] + 1 : j + 1;
					}
					continue;
				}
				j++;
			}
			return close + 1;
		}
		return i + 1;
	};

	// Skip an optional `?`, type annotation and default value, up to the comma
	// that ends this parameter (or `end`). Generic `<...>` commas don't count.
	const skipParamTail = (from: number, end: number): number => {
		let j = from;
		let angle = 0;
		while (j < end) {
			const t = tokens[j];
			if (t.kind === 'punct') {
				if (t.text === ',' && angle === 0) break;
				if (t.text === '<') angle++;
				else if (t.text === '>') angle = Math.max(0, angle - 1);
				else if (t.text === '>>') angle = Math.max(0, angle - 2);
				else if (t.text === '>>>') angle = Math.max(0, angle - 3);
				if (isOpener(t) && match[j] > j) {
					j = match[j] + 1;
					continue;
				}
			}
			j++;
		}
		return j;
	};

	// Whether the `(` at `open` begins a parameter list (arrow, method, function
	// or catch clause) rather than a call or a grouping.
	const isParamsGroup = (open: number): boolean => {
		const close = match[open];
		if (close < 0) return false;
		const prev = tokens[open - 1];
		const next = tokens[close + 1];
		if (!next) return false;
		if (next.kind === 'punct' && next.text === '=>') return true;
		if (next.kind === 'punct' && next.text === '{') {
			if (!prev) return false;
			if (prev.kind === 'id') return !CONTROL_HEADS.has(prev.text);
			return prev.kind === 'punct' && prev.text === '>';
		}
		if (next.kind === 'punct' && next.text === ':') {
			// A return type annotation: params if it leads to `=>` or a body.
			let k = close + 2;
			while (k < tokens.length) {
				const t = tokens[k];
				if (t.kind === 'punct') {
					if (t.text === '=>') return true;
					if (t.text === '{') {
						if (prev?.kind === 'id' && !CONTROL_HEADS.has(prev.text)) return true;
						if (match[k] < 0) return false;
						k = match[k] + 1;
						continue;
					}
					if (
						t.text === ';' ||
						t.text === ',' ||
						t.text === ')' ||
						t.text === '}' ||
						t.text === '='
					) {
						return false;
					}
					if (isOpener(t) && match[k] > k) {
						k = match[k] + 1;
						continue;
					}
				}
				k++;
			}
		}
		return false;
	};

	const markParams = (open: number): void => {
		const close = match[open];
		let i = open + 1;
		while (i < close) {
			while (
				isId(i) &&
				PARAM_PROPERTY_MODIFIERS.has(text(i)) &&
				(isId(i + 1) || isPunct(i + 1, '{') || isPunct(i + 1, '['))
			)
				i++;
			if (isPunct(i, '...')) i++;
			const found: number[] = [];
			i = markPattern(i, found);
			for (const k of found) role[k] = ROLE_BINDING;
			i = skipParamTail(i, close);
			i++;
		}
	};

	// `name` at a member position: first in a class/enum/interface/object body.
	const memberStart = (i: number): boolean => {
		const prev = tokens[i - 1];
		if (!prev) return false;
		if (prev.kind === 'punct') {
			if (prev.text === '{' || prev.text === ';' || prev.text === ',' || prev.text === '}')
				return true;
			if (prev.text === '*') return memberStart(i - 1);
		}
		if (prev.kind === 'id' && MEMBER_MODIFIERS.has(prev.text) && memberStart(i - 1)) return true;
		if (prev.line < tokens[i].line) {
			if (prev.kind === 'punct')
				return (
					prev.text === '}' ||
					prev.text === ';' ||
					prev.text === ')' ||
					prev.text === ']' ||
					prev.text === '>'
				);
			return true;
		}
		return false;
	};

	const stack: Ctx[] = [];
	let pendingBody: BodyKind | null = null;
	let pendingDepth = 0;

	const parseImport = (i: number): number => {
		// `import 'x'`, `import x from 'x'`, `import * as ns from 'x'`, `import { a as b } from 'x'`.
		let j = i + 1;
		const t = tokens[j];
		if (!t) return j;
		if (t.kind === 'str') {
			scan.imports.push({ source: t.text, bindings: [] });
			return j + 1;
		}
		if (isPunct(j, '(')) {
			const lit = tokens[j + 1];
			scan.dynamic.push({
				source: lit?.kind === 'str' && isPunct(j + 2, ')') ? lit.text : null,
				via: 'import'
			});
			return i + 1;
		}
		if (isPunct(j, '.')) return i + 1;
		role[i] = ROLE_SKIP;
		let typeOnly = false;
		if (
			isId(j, 'type') &&
			!isId(j + 1, 'from') &&
			(isId(j + 1) || isPunct(j + 1, '{') || isPunct(j + 1, '*'))
		) {
			typeOnly = true;
			role[j] = ROLE_SKIP;
			j++;
		}
		const bindings: ImportBinding[] = [];
		while (j < tokens.length && !isId(j, 'from')) {
			const c = tokens[j];
			if (c.kind === 'str') break;
			if (isPunct(j, ';')) break;
			role[j] = ROLE_SKIP;
			if (isPunct(j, '*') && isId(j + 1, 'as') && isId(j + 2)) {
				role[j + 1] = ROLE_SKIP;
				role[j + 2] = ROLE_SKIP;
				bindings.push({ kind: 'namespace', imported: '*', local: text(j + 2), typeOnly });
				j += 3;
				continue;
			}
			if (isPunct(j, '{') && match[j] > j) {
				const close = match[j];
				let k = j + 1;
				while (k < close) {
					role[k] = ROLE_SKIP;
					let itemTypeOnly = typeOnly;
					if (
						isId(k, 'type') &&
						(isId(k + 1) || tokens[k + 1]?.kind === 'str') &&
						!isId(k + 1, 'as')
					) {
						itemTypeOnly = true;
						k++;
						role[k] = ROLE_SKIP;
					}
					const importedTok = tokens[k];
					if (importedTok && (importedTok.kind === 'id' || importedTok.kind === 'str')) {
						let local = importedTok.text;
						if (isId(k + 1, 'as') && isId(k + 2)) {
							role[k + 1] = ROLE_SKIP;
							role[k + 2] = ROLE_SKIP;
							local = text(k + 2);
							k += 2;
						}
						bindings.push({
							kind: 'named',
							imported: importedTok.text,
							local,
							typeOnly: itemTypeOnly
						});
					}
					k++;
					while (k < close && !isPunct(k, ',')) {
						role[k] = ROLE_SKIP;
						k++;
					}
					k++;
				}
				j = close + 1;
				continue;
			}
			if (c.kind === 'id') {
				if (isPunct(j + 1, '=')) return i + 1; // `import x = require()`
				bindings.push({ kind: 'default', imported: 'default', local: c.text, typeOnly });
			}
			j++;
		}
		if (isId(j, 'from')) {
			role[j] = ROLE_SKIP;
			j++;
		}
		const src = tokens[j];
		if (src?.kind === 'str') {
			role[j] = ROLE_SKIP;
			scan.imports.push({ source: src.text, bindings });
			j++;
		}
		return j;
	};

	const parseExport = (i: number): number => {
		role[i] = ROLE_SKIP;
		let j = i + 1;
		if (isId(j, 'type') && (isPunct(j + 1, '{') || isPunct(j + 1, '*'))) {
			role[j] = ROLE_SKIP;
			j++;
		}
		if (isPunct(j, '{') && match[j] > j) {
			const close = match[j];
			const items: { local: string; exported: string; k: number }[] = [];
			let k = j + 1;
			while (k < close) {
				role[k] = ROLE_SKIP;
				if (
					isId(k, 'type') &&
					(isId(k + 1) || tokens[k + 1]?.kind === 'str') &&
					!isId(k + 1, 'as')
				) {
					k++;
					role[k] = ROLE_SKIP;
				}
				const localTok = tokens[k];
				if (localTok && (localTok.kind === 'id' || localTok.kind === 'str')) {
					let exported = localTok.text;
					const at = k;
					if (isId(k + 1, 'as') && tokens[k + 2]) {
						role[k + 1] = ROLE_SKIP;
						role[k + 2] = ROLE_SKIP;
						exported = text(k + 2);
						k += 2;
					}
					items.push({ local: localTok.text, exported, k: at });
				}
				k++;
				while (k < close && !isPunct(k, ',')) {
					role[k] = ROLE_SKIP;
					k++;
				}
				k++;
			}
			j = close + 1;
			if (isId(j, 'from') && tokens[j + 1]?.kind === 'str') {
				role[j] = ROLE_SKIP;
				role[j + 1] = ROLE_SKIP;
				scan.reexports.push({
					source: text(j + 1),
					kind: 'named',
					items: items.map((it) => ({
						imported: it.local,
						exported: it.exported,
						start: tokens[it.k].start,
						line: tokens[it.k].line,
						col: tokens[it.k].col
					}))
				});
				return j + 2;
			}
			for (const it of items) {
				const tok = tokens[it.k];
				scan.localExports.push({
					local: it.local,
					exported: it.exported,
					start: tok.start,
					line: tok.line,
					col: tok.col
				});
			}
			return j;
		}
		if (isPunct(j, '*')) {
			role[j] = ROLE_SKIP;
			let nsName: string | undefined;
			if (isId(j + 1, 'as') && isId(j + 2)) {
				role[j + 1] = ROLE_SKIP;
				role[j + 2] = ROLE_SKIP;
				nsName = text(j + 2);
				j += 2;
			}
			if (isId(j + 1, 'from') && tokens[j + 2]?.kind === 'str') {
				role[j + 1] = ROLE_SKIP;
				role[j + 2] = ROLE_SKIP;
				scan.reexports.push({
					source: text(j + 2),
					kind: nsName ? 'starAs' : 'star',
					items: [],
					nsName
				});
				return j + 3;
			}
			return j + 1;
		}
		if (isId(j, 'default')) {
			const target = tokens[j + 1];
			const after = tokens[j + 2];
			const isDeclaration =
				target?.kind === 'id' &&
				(target.text === 'function' ||
					target.text === 'class' ||
					target.text === 'async' ||
					target.text === 'abstract' ||
					target.text === 'interface');
			if (
				target?.kind === 'id' &&
				!isDeclaration &&
				(!after || isPunct(j + 2, ';') || after.line > target.line)
			) {
				// `export default name;` exposes `name` without using it.
				role[j + 1] = ROLE_SKIP;
				scan.localExports.push({
					local: target.text,
					exported: 'default',
					start: target.start,
					line: target.line,
					col: target.col
				});
			}
		}
		return i + 1;
	};

	// Top-level declarations and the bindings that shadow them.
	const handleDeclKeyword = (i: number): boolean => {
		const kw = text(i);
		const depth = stack.length;
		const top = !markup && depth === 0;

		if (kw === 'const' || kw === 'let' || kw === 'var') {
			// `const enum` is an enum, not a variable.
			if (kw === 'const' && isId(i + 1, 'enum')) return false;
			// `for (let ...`: the loop variable is a binding, never top level.
			const found: number[] = [];
			markPattern(i + 1, found);
			const prefix = declPrefix(i);
			const isTopDecl = top && atStatementStart(prefix.first);
			if (isTopDecl) {
				for (const k of found) {
					role[k] = ROLE_SKIP;
					scan.topLevel.add(text(k));
				}
				const nameIdx = found[0];
				// Only the first declarator becomes a lens, and only when the
				// declaration binds a plain identifier (not a destructuring pattern).
				if (nameIdx !== undefined && nameIdx === i + 1) {
					let k = nameIdx + 1;
					// `name: Type = ...`: step over the annotation to the `=`.
					if (isPunct(k, ':')) {
						let angle = 0;
						k++;
						while (k < tokens.length && !(angle === 0 && (isPunct(k, '=') || isPunct(k, ';')))) {
							const tk = tokens[k];
							if (tk.kind === 'punct') {
								if (tk.text === '<') angle++;
								else if (tk.text === '>') angle = Math.max(0, angle - 1);
								else if (tk.text === '>>') angle = Math.max(0, angle - 2);
								else if (isOpener(tk) && match[k] > k) {
									k = match[k] + 1;
									continue;
								}
							}
							k++;
						}
					}
					let functionLike = false;
					if (isPunct(k, '=')) {
						const v = k + 1;
						if (
							isId(v, 'function') ||
							(isId(v, 'async') && (isId(v + 1, 'function') || isPunct(v + 1, '(') || isId(v + 1)))
						) {
							functionLike = true;
						} else if (isPunct(v, '(') && match[v] > v) {
							const after = tokens[match[v] + 1];
							functionLike = after?.kind === 'punct' && (after.text === '=>' || after.text === ':');
						} else if (isId(v) && isPunct(v + 1, '=>')) {
							functionLike = true;
						}
					}
					const nameTok = tokens[nameIdx];
					scan.decls.push({
						name: nameTok.text,
						kind: kw,
						line: tokens[prefix.first].line,
						nameLine: nameTok.line,
						nameCol: nameTok.col,
						exported: prefix.exported && !prefix.isDefault,
						isDefault: prefix.isDefault,
						functionLike,
						componentProp: prefix.exported && seg.svelteInstance,
						svelteInstance: seg.svelteInstance
					});
				}
			} else {
				for (const k of found) role[k] = ROLE_BINDING;
			}
			return true;
		}

		// function / class / interface / type / enum name.
		let nameIdx = i + 1;
		if (kw === 'function' && isPunct(nameIdx, '*')) nameIdx++;
		if (!isId(nameIdx)) return false;
		if (kw === 'function' && !(isPunct(nameIdx + 1, '(') || isPunct(nameIdx + 1, '<')))
			return false;
		if (kw === 'type') {
			// A real alias: `type Name =` / `type Name<`.
			if (!(isPunct(nameIdx + 1, '=') || isPunct(nameIdx + 1, '<'))) return false;
		}
		if (
			kw === 'interface' &&
			!(isPunct(nameIdx + 1, '{') || isPunct(nameIdx + 1, '<') || isId(nameIdx + 1, 'extends'))
		)
			return false;
		if (kw === 'class' && (isId(nameIdx, 'extends') || isId(nameIdx, 'implements'))) return false;
		if (kw === 'enum' && !isPunct(nameIdx + 1, '{')) return false;

		const prefix = declPrefix(i);
		const isTopDecl = top && atStatementStart(prefix.first);
		const nameTok = tokens[nameIdx];
		if (isTopDecl) {
			role[nameIdx] = ROLE_SKIP;
			scan.topLevel.add(nameTok.text);
			scan.decls.push({
				name: nameTok.text,
				kind: kw as DeclKind,
				line: tokens[prefix.first].line,
				nameLine: nameTok.line,
				nameCol: nameTok.col,
				exported: prefix.exported && !prefix.isDefault,
				isDefault: prefix.isDefault,
				functionLike: kw === 'function',
				componentProp: prefix.exported && seg.svelteInstance && kw !== 'type' && kw !== 'interface',
				svelteInstance: seg.svelteInstance
			});
		} else {
			// A nested or expression-position declaration binds its name locally.
			role[nameIdx] = ROLE_BINDING;
		}
		return true;
	};

	// Svelte block heads: `{#each a as b, i}`, `{#snippet name(p)}`, `{@const x = 1}`,
	// `{:then v}`, `{#await p then v}`. Their names are bindings, not references.
	if (markup && seg.head) {
		const bindFrom = (start: number): number => {
			const found: number[] = [];
			const after = markPattern(start, found);
			for (const k of found) role[k] = ROLE_BINDING;
			return after;
		};
		const head = seg.head;
		if (head === 'each') {
			for (let k = 0; k < tokens.length; k++) {
				if (isId(k, 'as') && match[k] < 0) {
					role[k] = ROLE_SKIP;
					const after = bindFrom(k + 1);
					if (isPunct(after, ',') && isId(after + 1)) role[after + 1] = ROLE_BINDING;
					break;
				}
			}
		} else if (head === 'const' || head === 'then' || head === 'catch') {
			bindFrom(0);
		} else if (head === 'snippet') {
			if (isId(0)) role[0] = ROLE_BINDING;
			if (isPunct(1, '(') && match[1] > 1) markParams(1);
		} else if (head === 'await') {
			for (let k = 0; k < tokens.length; k++) {
				if ((isId(k, 'then') || isId(k, 'catch')) && match[k] < 0) {
					role[k] = ROLE_SKIP;
					bindFrom(k + 1);
				}
			}
		}
	}

	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];

		if (t.kind === 'punct') {
			if (isOpener(t)) {
				if (t.text === '(' && isParamsGroup(i)) markParams(i);
				let kind: BodyKind = 'other';
				if (t.text === '{' && pendingBody && stack.length === pendingDepth) {
					kind = pendingBody;
					pendingBody = null;
				}
				stack.push({ open: t.text, kind });
			} else if (isCloser(t)) {
				stack.pop();
			}
			continue;
		}
		if (t.kind !== 'id') continue;

		const prev = tokens[i - 1];
		const afterDot = prev?.kind === 'punct' && (prev.text === '.' || prev.text === '?.');
		const word = t.text;

		if (!afterDot && !markup) {
			if (word === 'import' && stack.length === 0) {
				const next = parseImport(i);
				if (next > i + 1) {
					i = next - 1;
					continue;
				}
			} else if (word === 'export' && stack.length === 0) {
				const next = parseExport(i);
				if (next > i + 1) {
					i = next - 1;
					continue;
				}
			} else if (
				word === 'require' &&
				isPunct(i + 1, '(') &&
				!(prev?.kind === 'id' && prev.text === 'function')
			) {
				const lit = tokens[i + 2];
				if (lit?.kind === 'str' && isPunct(i + 3, ')')) {
					scan.dynamic.push({ source: lit.text, via: 'require' });
				}
			}
		}

		if (!afterDot) {
			if (word === 'class' || word === 'enum' || word === 'interface') {
				const named = isId(i + 1) && !isId(i + 1, 'extends') && !isId(i + 1, 'implements');
				const anonClass =
					word === 'class' &&
					(isPunct(i + 1, '{') || isId(i + 1, 'extends') || isId(i + 1, 'implements'));
				if (named || anonClass) {
					pendingBody = word === 'class' ? 'class' : word === 'enum' ? 'enum' : 'interface';
					pendingDepth = stack.length;
				}
			}
			if (
				word === 'function' ||
				word === 'class' ||
				word === 'interface' ||
				word === 'type' ||
				word === 'enum' ||
				word === 'const' ||
				word === 'let' ||
				word === 'var'
			) {
				// `type` is only a keyword at a declaration; anywhere else it is an
				// ordinary identifier and falls through to normal classification.
				const handled = handleDeclKeyword(i);
				if (handled || word !== 'type') continue;
			}
		}

		if (role[i] !== ROLE_REF) continue;
		if (RESERVED.has(word)) continue;

		if (afterDot) {
			pushOccurrence(acc, tokens, i, true);
			continue;
		}

		const top = stack[stack.length - 1];
		const next = tokens[i + 1];

		// `{ name: value }`, `name?: T`, a member signature key.
		const nextIsColon =
			next?.kind === 'punct' && (next.text === ':' || (next.text === '?' && isPunct(i + 2, ':')));
		if (nextIsColon && top && (top.open === '{' || top.open === '[')) {
			const p = prev;
			const keyPrev =
				p === undefined ||
				(p.kind === 'punct' &&
					(p.text === '{' || p.text === ',' || p.text === ';' || p.text === '[')) ||
				(p.line < t.line &&
					!(p.kind === 'punct' && (p.text === '?' || p.text === ':')) &&
					!(p.kind === 'id' && p.text === 'case')) ||
				(p.kind === 'id' && MEMBER_MODIFIERS.has(p.text));
			if (keyPrev) {
				role[i] = ROLE_KEY;
				continue;
			}
		}

		// Member definitions inside class / enum / interface / object bodies. A
		// comma only separates members in an enum or object body; inside a class or
		// interface it is far more likely a generic argument (`Map<string, Foo>`),
		// so there a member must look like one (`name:`, `name?`, `name(`).
		if (top && top.open === '{' && memberStart(i)) {
			const afterComma = prev?.kind === 'punct' && prev.text === ',';
			const n = next;
			const looksMember =
				n !== undefined &&
				n.kind === 'punct' &&
				(n.text === ':' || n.text === '?' || n.text === '(');
			if (top.kind === 'class') {
				if (
					!afterComma &&
					(looksMember ||
						n === undefined ||
						(n.kind === 'punct' && ['=', ';', '!', '<', '}'].includes(n.text)) ||
						n.line > t.line)
				) {
					role[i] = ROLE_KEY;
					continue;
				}
			} else if (top.kind === 'enum') {
				if (n === undefined || (n.kind === 'punct' && [',', '}', '='].includes(n.text))) {
					role[i] = ROLE_KEY;
					continue;
				}
			} else if (top.kind === 'interface') {
				if (
					looksMember ||
					(!afterComma &&
						n !== undefined &&
						n.kind === 'punct' &&
						[';', '<', '}', ','].includes(n.text))
				) {
					role[i] = ROLE_KEY;
					continue;
				}
			} else if (isPunct(i + 1, '(') && match[i + 1] > i + 1) {
				// Object-literal or type-literal method: `name(args) {` / `name(args): T`.
				const after = tokens[match[i + 1] + 1];
				if (after?.kind === 'punct' && (after.text === '{' || after.text === ':')) {
					role[i] = ROLE_KEY;
					continue;
				}
			}
		}

		// `x => ...`: a single unparenthesised arrow parameter.
		if (isPunct(i + 1, '=>')) {
			role[i] = ROLE_BINDING;
			continue;
		}

		pushOccurrence(acc, tokens, i, false);
	}

	for (let i = 0; i < tokens.length; i++) {
		if (role[i] === ROLE_BINDING && tokens[i].kind === 'id') scan.shadows.add(tokens[i].text);
	}
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

const SCANNABLE = /\.(?:[cm]?[jt]s|svelte)$/;

export function isScannablePath(path: string): boolean {
	return SCANNABLE.test(path);
}

export function scanFile(text: string, path: string): FileScan | null {
	if (!isScannablePath(path)) return null;
	const starts = buildLineStarts(text);
	const scan: FileScan = {
		decls: [],
		localExports: [],
		imports: [],
		reexports: [],
		dynamic: [],
		occurrences: [],
		shadows: new Set(),
		topLevel: new Set()
	};
	const acc: Accumulator = { scan };

	if (path.endsWith('.svelte')) {
		const layout = splitSvelte(text);
		for (const s of layout.scripts) {
			const r = lex(text, s.from, s.to, starts, false);
			analyzeSegment({ tokens: r.tokens, markup: false, svelteInstance: !s.module }, acc);
		}
		const segments: Segment[] = [];
		for (const [a, b] of layout.markup) scanMarkup(text, a, b, starts, segments);
		for (const seg of segments) analyzeSegment(seg, acc);
	} else {
		const r = lex(text, 0, text.length, starts, false);
		analyzeSegment({ tokens: r.tokens, markup: false, svelteInstance: false }, acc);
	}

	// Overloads and merged declarations repeat a name; the first one is the lens.
	const seen = new Set<string>();
	scan.decls = scan.decls.filter((d) => {
		if (seen.has(d.name)) return false;
		seen.add(d.name);
		return true;
	});
	return scan;
}
