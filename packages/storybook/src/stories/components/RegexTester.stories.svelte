<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DiffView from '@super-review/ui/components/DiffView.svelte';
	import { setCachedDiff } from '@super-review/ui/store.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import RegexTesterPlayground from '../../lib/RegexTesterPlayground.svelte';
	import { seedStore } from '../../lib/store-harness';
	import { makeRepos } from '../../lib/fixtures';
	import type { ChangedFile } from '@super-review/core/types';

	// The inline regex tester lives on the diff: hovering a regex literal in a
	// JS/TS file hints that it can be tested, and clicking one opens a popup that
	// evaluates it live against a test string. These stories cover it end to end
	// (a real Pierre-rendered diff, real token events) plus a bench for the popup
	// on its own.
	const repo = makeRepos(1)[0];

	// Lines are written out rather than templated so what the detector sees here
	// is exactly what a reviewer would see in the file.
	const VALIDATORS_OLD = [
		"import { fail } from './result';",
		'',
		'export const EMAIL = /^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i;',
		'export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;',
		'export const SEMVER = /^\\d+\\.\\d+\\.\\d+$/;',
		'',
		'// Not regexes: the tester leaves division alone.',
		'export function aspect(width, height) {',
		'\treturn width / height / 2;',
		'}',
		'',
		'export function normalize(input) {',
		"\treturn input.trim().replace(/\\s+/g, ' ');",
		'}',
		'',
		'export function isHexColor(value) {',
		'\treturn /^#[0-9a-f]{3}$/i.test(value);',
		'}',
		''
	].join('\n');

	// The new side moves two literals and adds two more, so literals appear on
	// added, deleted and context lines, and each side resolves against its own
	// contents.
	const VALIDATORS_NEW = [
		"import { fail } from './result';",
		'',
		'export const EMAIL = /^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i;',
		'export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;',
		'export const SEMVER = /^(\\d+)\\.(\\d+)\\.(\\d+)(?:-([\\w.]+))?$/;',
		'// Path separators, both kinds. The slash inside the class is literal.',
		'export const SEP = /[/\\\\]+/g;',
		'// A typo a reviewer should catch: this one does not compile.',
		'export const RANGE = /(unclosed/;',
		'',
		'// Not regexes: the tester leaves division alone.',
		'export function aspect(width, height) {',
		'\treturn width / height / 2;',
		'}',
		'',
		'export function normalize(input) {',
		"\treturn input.trim().replace(/\\s+/g, ' ').replace(/[\\u200b]/g, '');",
		'}',
		'',
		'export function isHexColor(value) {',
		'\treturn /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);',
		'}',
		''
	].join('\n');

	// Cases that decide whether a `/` is a regex at all: strings, comments,
	// template literals and division all contain slashes that must not become
	// testable literals.
	const AMBIGUOUS = [
		'const url = "https://example.com/a/b";',
		'const path = `${dir}/${name}.txt`;',
		'// A comment mentioning /not-a-regex/ in passing.',
		'/* Nor this one: /still-not/g */',
		'const half = total / count;',
		'let running = total;',
		'running /= count;',
		'const parts = line.split(/\\s*,\\s*/);',
		'const first = parts.find((p) => /^-{2}/.test(p));',
		'const stripped = raw.replace(/^\\/+|\\/+$/g, "");',
		'const both = [/^a/, /b$/i];',
		'const interpolated = `x${line.replace(/\\d/g, "#")}y`;',
		''
	].join('\n');

	// Seeds one file's diff and points the view at it. An empty `oldContents`
	// makes it a new file, which renders every line as an addition, the way to
	// get a whole fixture on screen at once. (Identical sides render the
	// "No content changes" empty state instead, so never pass the same text
	// twice.)
	function seedFile(
		path: string,
		oldContents: string,
		newContents: string,
		viewMode: 'split' | 'unified' = 'split'
	) {
		const file: ChangedFile = {
			path,
			status: oldContents === '' ? 'added' : 'modified',
			additions: newContents.split('\n').length,
			deletions: oldContents === '' ? 0 : oldContents.split('\n').length,
			isBinary: false,
			contentSig: `sig-${path}`
		};
		seedStore({
			repos: [repo],
			activeRepo: repo,
			currentBranch: 'feat/validators',
			contextTab: 'branch',
			diffContext: { kind: 'workingTree' },
			changedFiles: [file],
			selectedFile: file.path,
			diffLayout: 'scroll',
			viewMode
		});
		setCachedDiff(repo.id, { kind: 'workingTree' }, file.path, {
			file,
			patch: '',
			oldContents,
			newContents,
			truncated: false
		});
	}

	const { Story } = defineMeta({
		title: 'Components/Regex Tester',
		parameters: { layout: 'centered' }
	});
</script>

<!--
	The feature in situ. Hover a literal such as `/^\d+\.\d+\.\d+$/` for the
	"Test regex" hint, then click it: the popup opens under the literal with the
	input focused, and typing evaluates against the browser's own RegExp. Both
	sides of the diff are indexed, so literals on removed lines work too.
-->
<Story name="In a diff">
	{#snippet template()}
		<StoreScope
			setup={() => seedFile('src/lib/validators.ts', VALIDATORS_OLD, VALIDATORS_NEW)}
			width="980px"
			height="620px"
		>
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<!-- Same file unified, where both sides share one column of line numbers. -->
<Story name="In a diff (unified)">
	{#snippet template()}
		<StoreScope
			setup={() => seedFile('src/lib/validators.ts', VALIDATORS_OLD, VALIDATORS_NEW, 'unified')}
			width="980px"
			height="620px"
		>
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<!--
	Detection edge cases. Only the last five lines carry real literals: the URL,
	the template path, the two comments and the division above them all contain
	slashes that must stay inert (no hint on hover, no popup on click).
-->
<Story name="Slashes that are not regexes">
	{#snippet template()}
		<StoreScope
			setup={() => seedFile('src/lib/parse.ts', '', AMBIGUOUS)}
			width="980px"
			height="620px"
		>
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<!--
	The popup on its own, driven by plain spans instead of a diff. The quickest
	way to work through its states: a match with its character range, the
	multi-match highlight a `g` literal produces, an empty-string match, no match,
	and the error state for a literal that does not compile.
-->
<Story name="Popup states">
	{#snippet template()}
		<StoreScope frame={false}>
			<div class="w-[720px] rounded-lg border border-border bg-background">
				<RegexTesterPlayground />
			</div>
		</StoreScope>
	{/snippet}
</Story>
