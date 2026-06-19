// Locates dependency entries inside a package.json so the diff viewer can map a
// hovered token back to "this is the package <name>" or "this is the version
// range for <name>". Pierre reports a hovered token as a line number + a
// character range within that line (its `data-char` offset); this builds the
// matching index: line → the name/version spans on that line, with their own
// character ranges, so a hover is resolved with a cheap range-overlap test.
//
// It's a tiny hand-rolled JSON scanner rather than `JSON.parse` because we need
// source positions (line + column), and because a half-typed package.json in a
// working-tree diff may not parse at all — the scanner degrades gracefully and
// still indexes the entries it has seen.

// The top-level objects whose entries are `"<name>": "<version-range>"`.
export const DEPENDENCY_FIELDS = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies'
] as const;
export type DependencyField = (typeof DEPENDENCY_FIELDS)[number];

const DEP_FIELD_SET = new Set<string>(DEPENDENCY_FIELDS);

export interface DepTokenSpan {
	// Whether this span covers the package name (the JSON key) or its version
	// range (the JSON value).
	kind: 'name' | 'version';
	// 0-based character offsets within the line, end-exclusive, spanning the
	// quoted string including its quotes. Matched against Pierre's token range.
	startCol: number;
	endCol: number;
	// The dependency this span belongs to — both name and version are carried so
	// the version card can look the package up and the name card knows the range.
	name: string;
	version: string;
	field: DependencyField;
}

// Line number (1-based, matching Pierre's `data-line`) → spans on that line.
// Almost always one name + one version per line, but the index doesn't assume
// the two sit on the same line.
export type PackageDepIndex = Map<number, DepTokenSpan[]>;

function addSpan(index: PackageDepIndex, line: number, span: DepTokenSpan): void {
	const existing = index.get(line);
	if (existing) existing.push(span);
	else index.set(line, [span]);
}

// True when `package.json` is the file's basename — the only files we index.
// Handles both `/` and `\` separators so it works regardless of the platform
// the diff's paths came from.
export function isPackageJsonPath(filePath: string): boolean {
	const base = filePath.split(/[\\/]/).pop() ?? filePath;
	return base === 'package.json';
}

// Scan package.json text and index the dependency name/version spans by line.
// `text` is the full contents of one side of the diff (old or new); the caller
// keys the result by which side the hovered token reported.
export function parsePackageDeps(text: string): PackageDepIndex {
	const index: PackageDepIndex = new Map();
	// Stack of the currently-open containers. For objects, `key` is the property
	// name that introduced them (null for the root and for arrays), which lets us
	// recognise a dependency block as a depth-2 object keyed by a dependency field.
	const containers: { key: string | null }[] = [];
	// The most recent property key still awaiting its value, with its position so
	// it can become a name span once we confirm a string value follows.
	let pendingKey: { text: string; line: number; startCol: number; endCol: number } | null = null;

	const inDepBlock = (): boolean =>
		containers.length === 2 && containers[1].key != null && DEP_FIELD_SET.has(containers[1].key);

	const n = text.length;
	let i = 0;
	let line = 1;
	let col = 0;

	while (i < n) {
		const ch = text[i];

		if (ch === '\n') {
			line++;
			col = 0;
			i++;
			continue;
		}

		if (ch === '{' || ch === '[') {
			// An object is keyed by the pending property name; an array isn't keyed.
			// Either way the pending key has now been consumed as this container's
			// value, so a stranded key can't bind to something inside.
			containers.push({ key: ch === '{' ? (pendingKey?.text ?? null) : null });
			pendingKey = null;
			col++;
			i++;
			continue;
		}

		if (ch === '}' || ch === ']') {
			containers.pop();
			pendingKey = null;
			col++;
			i++;
			continue;
		}

		if (ch === '"') {
			// Read a string literal, tracking columns (JSON strings never contain a
			// raw newline, so this stays on one line). Escapes are stepped over so a
			// `\"` doesn't end the string early; the decoded text isn't needed beyond
			// names/versions, which carry no escapes.
			const startCol = col;
			const startLine = line;
			let value = '';
			let j = i + 1;
			let c = col + 1;
			while (j < n) {
				const cj = text[j];
				if (cj === '\\') {
					value += text[j + 1] ?? '';
					j += 2;
					c += 2;
					continue;
				}
				if (cj === '"') {
					j++;
					c++;
					break;
				}
				value += cj;
				j++;
				c++;
			}
			const endCol = c; // exclusive, just past the closing quote

			// A string is a key when the next significant character is a colon.
			let k = j;
			while (k < n && (text[k] === ' ' || text[k] === '\t' || text[k] === '\r' || text[k] === '\n'))
				k++;
			if (text[k] === ':') {
				pendingKey = { text: value, line: startLine, startCol, endCol };
			} else if (pendingKey && inDepBlock()) {
				// A string value directly inside a dependency block — record the
				// name (from the key) and the version (this value) as a pair.
				const field = containers[1].key as DependencyField;
				const name = pendingKey.text;
				addSpan(index, pendingKey.line, {
					kind: 'name',
					startCol: pendingKey.startCol,
					endCol: pendingKey.endCol,
					name,
					version: value,
					field
				});
				addSpan(index, startLine, {
					kind: 'version',
					startCol,
					endCol,
					name,
					version: value,
					field
				});
				pendingKey = null;
			} else {
				pendingKey = null;
			}

			i = j;
			col = c;
			continue;
		}

		col++;
		i++;
	}

	return index;
}

// The version range recorded for `name` anywhere in this side's index, or null
// if the package isn't present on that side. Lets the hover card resolve a
// package's old and new version from the two side indexes to detect a change.
export function versionForName(index: PackageDepIndex, name: string): string | null {
	for (const spans of index.values()) {
		for (const span of spans) {
			if (span.name === name) return span.version;
		}
	}
	return null;
}

// Find the dependency span (name or version) covering a hovered token, given
// the token's line and its character range. Returns the first span whose range
// overlaps the token — the spans include their quotes, so any sub-token (a
// stripped quote, an intra-line diff fragment) of the name/version still hits.
export function spanAt(
	index: PackageDepIndex,
	line: number,
	tokenStart: number,
	tokenEnd: number
): DepTokenSpan | null {
	const spans = index.get(line);
	if (!spans) return null;
	for (const span of spans) {
		if (tokenStart < span.endCol && tokenEnd > span.startCol) return span;
	}
	return null;
}
