<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import DiffView from '@super-review/ui/components/DiffView.svelte';
	import SymbolRefsLens from '@super-review/ui/components/SymbolRefsLens.svelte';
	import { app, setCachedDiff } from '@super-review/ui/store.svelte';
	import StoreScope from '../../lib/StoreScope.svelte';
	import { seedStore } from '../../lib/store-harness';
	import { makeRepos } from '../../lib/fixtures';
	import type {
		ChangedFile,
		FileSymbolRefs,
		SymbolLens,
		SymbolRefLocation
	} from '@super-review/core/types';

	// The lens sits above each top-level declaration in the Raw view. The real
	// counts come from the main process (git:getSymbolRefs); Storybook has no main
	// process, so these stories answer that call with fixed data at the IPC
	// boundary and let the real DiffFileSection and lens render it.
	const repo = makeRepos(1)[0];
	const FILE_PATH = 'src/lib/filters/relative-date.ts';

	const SOURCE = `import type { RelativeDateOption, RelativeDateParams, RelativeDateValue } from './types';

export function isRelativeDateValue(value: unknown): value is RelativeDateValue {
	return (
		typeof value === 'object' &&
		value !== null &&
		'relative' in value &&
		typeof value.relative === 'string'
	);
}

export function defaultRelativeParams(option: RelativeDateOption): RelativeDateParams {
	return Object.fromEntries((option.params ?? []).map((spec) => [spec.name, spec.default]));
}

/** Creates the value to store on a filter for an option, using its default params. */
export function createRelativeDateValue(option: RelativeDateOption): RelativeDateValue {
	return { relative: option.id, params: defaultRelativeParams(option) };
}

export function describeRelativeDate(value: RelativeDateValue): string {
	return value.relative.replaceAll('-', ' ');
}

export const RELATIVE_DATE_PRESETS = ['today', 'yesterday', 'last-7-days'] as const;
`;

	function lineOf(needle: string): number {
		return SOURCE.slice(0, SOURCE.indexOf(needle)).split('\n').length;
	}

	function locs(...rows: [string, number, string][]): SymbolRefLocation[] {
		return rows.map(([path, line, text]) => ({ path, line, col: 0, text }));
	}

	const LENSES: SymbolLens[] = [
		{
			name: 'isRelativeDateValue',
			kind: 'function',
			line: lineOf('export function isRelativeDateValue'),
			exported: true,
			count: 3,
			confidence: 'exact',
			locations: locs(
				[
					'src/lib/filters/serialize.ts',
					41,
					'if (isRelativeDateValue(value)) return encodeRelative(value);'
				],
				['src/lib/filters/serialize.ts', 88, 'return values.filter(isRelativeDateValue);'],
				[
					'src/lib/components/DateFilter.svelte',
					27,
					'const relative = $derived(isRelativeDateValue(filter.value));'
				]
			),
			locationsTruncated: false
		},
		{
			name: 'defaultRelativeParams',
			kind: 'function',
			line: lineOf('export function defaultRelativeParams'),
			exported: true,
			count: 1,
			confidence: 'exact',
			locations: locs([
				FILE_PATH,
				lineOf('params: defaultRelativeParams(option)'),
				'return { relative: option.id, params: defaultRelativeParams(option) };'
			]),
			locationsTruncated: false
		},
		{
			name: 'createRelativeDateValue',
			kind: 'function',
			line: lineOf('export function createRelativeDateValue'),
			exported: true,
			count: 0,
			confidence: 'exact',
			locations: [],
			locationsTruncated: false
		},
		{
			name: 'describeRelativeDate',
			kind: 'function',
			line: lineOf('export function describeRelativeDate'),
			exported: true,
			count: 2,
			confidence: 'atLeast',
			uncertainty: 'The module is imported dynamically somewhere.',
			locations: locs(
				['src/lib/components/FilterChip.svelte', 14, '{describeRelativeDate(filter.value)}'],
				['src/lib/filters/summary.ts', 9, 'parts.push(describeRelativeDate(value));']
			),
			locationsTruncated: false
		},
		{
			name: 'RELATIVE_DATE_PRESETS',
			kind: 'const',
			line: lineOf('export const RELATIVE_DATE_PRESETS'),
			exported: true,
			count: 0,
			confidence: 'atLeast',
			uncertainty:
				'Used by a framework or tool by convention (routes, hooks, config, generated API).',
			locations: [],
			locationsTruncated: false
		}
	];

	const file: ChangedFile = {
		path: FILE_PATH,
		status: 'modified',
		additions: 3,
		deletions: 0,
		isBinary: false,
		contentSig: 'sig-relative-date'
	};

	// Answer `window.api.git.getSymbolRefs` with the fixed data, leaving every
	// other call on the permissive stub the preview installs.
	function answerSymbolRefs(data: FileSymbolRefs): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const w = window as any;
		w.__srOriginalApi ??= w.api;
		const base = w.__srOriginalApi;
		w.api = new Proxy(base, {
			get(target, prop) {
				if (prop !== 'git') return target[prop];
				return new Proxy(base.git, {
					get(gitTarget, gitProp) {
						if (gitProp === 'getSymbolRefs') return async () => data;
						return gitTarget[gitProp];
					}
				});
			}
		});
	}

	// The same file before the change: two small edits far apart, so the diff has
	// two hunks and some declarations fall outside the rendered lines (those get no
	// lens, since there is no line above them to attach it to).
	const OLD_SOURCE = SOURCE.replace('replaceAll', 'replace').replace(
		'value !== null &&',
		'value != null &&'
	);

	function seedRaw(enabled: boolean, viewMode: 'split' | 'unified' = 'split'): void {
		const lineCount = SOURCE.endsWith('\n')
			? SOURCE.split('\n').length - 1
			: SOURCE.split('\n').length;
		answerSymbolRefs({ supported: true, lineCount, symbols: LENSES });
		seedStore({
			repos: [repo],
			activeRepo: repo,
			currentBranch: 'feat/relative-dates',
			contextTab: 'branch',
			diffContext: { kind: 'workingTree' },
			changedFiles: [file],
			selectedFile: file.path,
			diffLayout: 'scroll',
			viewMode
		});
		app.symbolReferences = enabled;
		setCachedDiff(repo.id, { kind: 'workingTree' }, file.path, {
			file,
			patch: '',
			oldContents: OLD_SOURCE,
			newContents: SOURCE,
			truncated: false
		});
	}

	const { Story } = defineMeta({
		title: 'Components/Symbol References',
		parameters: { layout: 'centered' }
	});
</script>

<!--
	The diff view with the setting on. Lenses appear above declarations whose
	previous line is part of the diff.
-->
<Story name="Diff view">
	{#snippet template()}
		<StoreScope setup={() => seedRaw(true)} width="980px" height="560px">
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<Story name="Diff view (unified)">
	{#snippet template()}
		<StoreScope setup={() => seedRaw(true, 'unified')} width="980px" height="560px">
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<!--
	The real Raw view with the setting on. Switch the file to "Raw" in its header
	to see a lens above each top-level declaration.
-->
<Story name="Raw view">
	{#snippet template()}
		<StoreScope setup={() => seedRaw(true)} width="980px" height="560px">
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<!-- Same file with the setting off: no lenses. -->
<Story name="Raw view (setting off)">
	{#snippet template()}
		<StoreScope setup={() => seedRaw(false)} width="980px" height="560px">
			<DiffView />
		</StoreScope>
	{/snippet}
</Story>

<!-- Every state the lens can be in. Click a count to see where it is used. -->
<Story name="Lens states">
	{#snippet template()}
		<div
			class="flex w-[420px] flex-col gap-1 rounded-lg border border-border bg-background p-4 font-mono text-xs"
		>
			{#each LENSES as symbol (symbol.name)}
				<div class="flex flex-col">
					<SymbolRefsLens {symbol} />
					<span class="pl-3 text-foreground">{symbol.kind} {symbol.name}</span>
				</div>
			{/each}
			<div class="flex flex-col">
				<SymbolRefsLens
					symbol={{
						...LENSES[0],
						name: 'formatLabel',
						count: 2,
						confidence: 'approximate',
						locations: LENSES[0].locations.slice(0, 2)
					}}
				/>
				<span class="pl-3 text-foreground">function formatLabel</span>
			</div>
		</div>
	{/snippet}
</Story>
