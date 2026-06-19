<script lang="ts">
	// Recreates the desktop app's diff customization: app light/dark theme, the
	// syntax-highlight theme picker (a curated subset of DIFF_THEMES), the code
	// font picker (codeFont), split vs. unified view (viewMode), and the file-icon
	// toggle (showFileIcons). Everything updates a live, syntax-highlighted diff.

	type Tok = [string, keyof Palette['tok']];
	type Palette = {
		bg: string;
		fg: string;
		gutter: string;
		lineNo: string;
		addBg: string;
		delBg: string;
		addGutter: string;
		delGutter: string;
		addMark: string;
		delMark: string;
		tok: {
			kw: string;
			fn: string;
			str: string;
			num: string;
			cmt: string;
			punc: string;
			var: string;
			txt: string;
		};
	};

	type Theme = { id: string; label: string; dark: Palette; light: Palette };

	const THEMES: Theme[] = [
		{
			id: 'pierre',
			label: 'Pierre',
			dark: {
				bg: '#141316',
				fg: '#d6d4da',
				gutter: '#1b1a1e',
				lineNo: '#54525a',
				addBg: 'rgba(126,226,168,0.10)',
				delBg: 'rgba(255,138,138,0.10)',
				addGutter: 'rgba(126,226,168,0.18)',
				delGutter: 'rgba(255,138,138,0.18)',
				addMark: '#7ee2a8',
				delMark: '#ff8a8a',
				tok: {
					kw: '#cf937e',
					fn: '#e3bd86',
					str: '#9ec79f',
					num: '#c4a6e8',
					cmt: '#5e5c63',
					punc: '#9d9ba2',
					var: '#d6d4da',
					txt: '#d6d4da'
				}
			},
			light: {
				bg: '#ffffff',
				fg: '#1f1e22',
				gutter: '#f6f5f7',
				lineNo: '#b3b1ba',
				addBg: 'rgba(10,158,79,0.08)',
				delBg: 'rgba(216,13,31,0.07)',
				addGutter: 'rgba(10,158,79,0.16)',
				delGutter: 'rgba(216,13,31,0.14)',
				addMark: '#0a9e4f',
				delMark: '#d80d1f',
				tok: {
					kw: '#b04a35',
					fn: '#946400',
					str: '#2f7a4f',
					num: '#6b3fb0',
					cmt: '#9a98a1',
					punc: '#56545c',
					var: '#1f1e22',
					txt: '#1f1e22'
				}
			}
		},
		{
			id: 'github',
			label: 'GitHub',
			dark: {
				bg: '#0d1117',
				fg: '#c9d1d9',
				gutter: '#0d1117',
				lineNo: '#484f58',
				addBg: 'rgba(46,160,67,0.15)',
				delBg: 'rgba(248,81,73,0.15)',
				addGutter: 'rgba(46,160,67,0.3)',
				delGutter: 'rgba(248,81,73,0.3)',
				addMark: '#3fb950',
				delMark: '#f85149',
				tok: {
					kw: '#ff7b72',
					fn: '#d2a8ff',
					str: '#a5d6ff',
					num: '#79c0ff',
					cmt: '#8b949e',
					punc: '#c9d1d9',
					var: '#ffa657',
					txt: '#c9d1d9'
				}
			},
			light: {
				bg: '#ffffff',
				fg: '#24292f',
				gutter: '#ffffff',
				lineNo: '#8c959f',
				addBg: 'rgba(46,160,67,0.1)',
				delBg: 'rgba(248,81,73,0.1)',
				addGutter: 'rgba(46,160,67,0.2)',
				delGutter: 'rgba(248,81,73,0.2)',
				addMark: '#1a7f37',
				delMark: '#cf222e',
				tok: {
					kw: '#cf222e',
					fn: '#8250df',
					str: '#0a3069',
					num: '#0550ae',
					cmt: '#6e7781',
					punc: '#24292f',
					var: '#953800',
					txt: '#24292f'
				}
			}
		},
		{
			id: 'catppuccin',
			label: 'Catppuccin',
			dark: {
				bg: '#1e1e2e',
				fg: '#cdd6f4',
				gutter: '#1e1e2e',
				lineNo: '#585b70',
				addBg: 'rgba(166,227,161,0.12)',
				delBg: 'rgba(243,139,168,0.12)',
				addGutter: 'rgba(166,227,161,0.24)',
				delGutter: 'rgba(243,139,168,0.24)',
				addMark: '#a6e3a1',
				delMark: '#f38ba8',
				tok: {
					kw: '#cba6f7',
					fn: '#89b4fa',
					str: '#a6e3a1',
					num: '#fab387',
					cmt: '#6c7086',
					punc: '#bac2de',
					var: '#f38ba8',
					txt: '#cdd6f4'
				}
			},
			light: {
				bg: '#eff1f5',
				fg: '#4c4f69',
				gutter: '#eff1f5',
				lineNo: '#9ca0b0',
				addBg: 'rgba(64,160,43,0.1)',
				delBg: 'rgba(210,15,57,0.08)',
				addGutter: 'rgba(64,160,43,0.2)',
				delGutter: 'rgba(210,15,57,0.18)',
				addMark: '#40a02b',
				delMark: '#d20f39',
				tok: {
					kw: '#8839ef',
					fn: '#1e66f5',
					str: '#40a02b',
					num: '#fe640b',
					cmt: '#9ca0b0',
					punc: '#5c5f77',
					var: '#d20f39',
					txt: '#4c4f69'
				}
			}
		},
		{
			id: 'gruvbox',
			label: 'Gruvbox',
			dark: {
				bg: '#282828',
				fg: '#ebdbb2',
				gutter: '#282828',
				lineNo: '#7c6f64',
				addBg: 'rgba(184,187,38,0.12)',
				delBg: 'rgba(251,73,52,0.12)',
				addGutter: 'rgba(184,187,38,0.24)',
				delGutter: 'rgba(251,73,52,0.24)',
				addMark: '#b8bb26',
				delMark: '#fb4934',
				tok: {
					kw: '#fb4934',
					fn: '#b8bb26',
					str: '#b8bb26',
					num: '#d3869b',
					cmt: '#928374',
					punc: '#ebdbb2',
					var: '#83a598',
					txt: '#ebdbb2'
				}
			},
			light: {
				bg: '#fbf1c7',
				fg: '#3c3836',
				gutter: '#fbf1c7',
				lineNo: '#a89984',
				addBg: 'rgba(121,116,14,0.12)',
				delBg: 'rgba(157,0,6,0.1)',
				addGutter: 'rgba(121,116,14,0.24)',
				delGutter: 'rgba(157,0,6,0.2)',
				addMark: '#79740e',
				delMark: '#9d0006',
				tok: {
					kw: '#9d0006',
					fn: '#79740e',
					str: '#79740e',
					num: '#8f3f71',
					cmt: '#928374',
					punc: '#3c3836',
					var: '#076678',
					txt: '#3c3836'
				}
			}
		}
	];

	const FONTS = [
		{ id: 'system', label: 'System', stack: "ui-monospace, 'SF Mono', Menlo, monospace" },
		{ id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', monospace" },
		{ id: 'fira', label: 'Fira Code', stack: "'Fira Code', monospace" }
	];

	// Logical diff lines. Each carries old/new line numbers and a tokenization so
	// syntax colors come from the selected theme's palette.
	type Line = { kind: 'ctx' | 'add' | 'del'; o?: number; n?: number; toks: Tok[] };

	const lines: Line[] = [
		{
			kind: 'ctx',
			o: 41,
			n: 41,
			toks: [
				['export ', 'kw'],
				['async ', 'kw'],
				['function ', 'kw'],
				['authenticate', 'fn'],
				['(', 'punc'],
				['req', 'var'],
				[': ', 'punc'],
				['Request', 'fn'],
				[') {', 'punc']
			]
		},
		{
			kind: 'del',
			o: 42,
			toks: [
				['  const ', 'kw'],
				['token', 'var'],
				[' = ', 'punc'],
				['req', 'var'],
				['.cookies.token', 'punc']
			]
		},
		{
			kind: 'add',
			n: 42,
			toks: [
				['  const ', 'kw'],
				['token', 'var'],
				[' = ', 'punc'],
				['await ', 'kw'],
				['getSession', 'fn'],
				['(', 'punc'],
				['req', 'var'],
				[')', 'punc']
			]
		},
		{
			kind: 'ctx',
			o: 43,
			n: 43,
			toks: [
				['  if ', 'kw'],
				['(!', 'punc'],
				['token', 'var'],
				[') ', 'punc'],
				['return ', 'kw'],
				['unauthorized', 'fn'],
				['()', 'punc']
			]
		},
		{
			kind: 'del',
			o: 44,
			toks: [
				['  return ', 'kw'],
				['decode', 'fn'],
				['(', 'punc'],
				['token', 'var'],
				[')', 'punc']
			]
		},
		{
			kind: 'add',
			n: 44,
			toks: [
				['  return ', 'kw'],
				['verify', 'fn'],
				['(', 'punc'],
				['token', 'var'],
				[', ', 'punc'],
				['env', 'var'],
				['.SESSION_SECRET', 'punc'],
				[')', 'punc']
			]
		},
		{ kind: 'ctx', o: 45, n: 45, toks: [['}', 'punc']] }
	];

	// Side-by-side rows: a del/add pair shares one row; context spans both columns.
	type SplitRow = { left?: Line; right?: Line };
	const splitRows: SplitRow[] = (() => {
		const rows: SplitRow[] = [];
		for (let i = 0; i < lines.length; i++) {
			const l = lines[i];
			if (l.kind === 'ctx') rows.push({ left: l, right: l });
			else if (l.kind === 'del') {
				const next = lines[i + 1];
				if (next?.kind === 'add') {
					rows.push({ left: l, right: next });
					i++;
				} else rows.push({ left: l });
			} else rows.push({ right: l });
		}
		return rows;
	})();

	const files = [
		{ name: 'session.ts', dir: 'src/auth', icon: 'ts', add: 3, del: 2, active: true },
		{ name: 'client.ts', dir: 'src/api', icon: 'ts', add: 12, del: 4 },
		{ name: 'package.json', dir: '', icon: 'json', add: 1, del: 0 },
		{ name: 'README.md', dir: '', icon: 'md', add: 8, del: 1 }
	];

	let appTheme = $state<'dark' | 'light'>('dark');
	let themeId = $state('pierre');
	let fontId = $state('system');
	let viewMode = $state<'split' | 'unified'>('split');
	let showIcons = $state(true);

	const theme = $derived(THEMES.find((t) => t.id === themeId)!);
	const p = $derived(appTheme === 'dark' ? theme.dark : theme.light);
	const font = $derived(FONTS.find((f) => f.id === fontId)!);

	function bgFor(kind: Line['kind']) {
		return kind === 'add' ? p.addBg : kind === 'del' ? p.delBg : 'transparent';
	}
	function gutterFor(kind: Line['kind']) {
		return kind === 'add' ? p.addGutter : kind === 'del' ? p.delGutter : p.gutter;
	}
	function markFor(kind: Line['kind']) {
		return kind === 'add' ? p.addMark : kind === 'del' ? p.delMark : 'transparent';
	}
</script>

<div class="grid gap-6 lg:grid-cols-[260px_1fr]">
	<!-- Controls -->
	<div class="border-line bg-elevated/60 flex flex-col gap-5 rounded-2xl border p-5">
		{@render segmented('Theme mode', appTheme, [
			{ id: 'dark', label: 'Dark' },
			{ id: 'light', label: 'Light' }
		], (v) => (appTheme = v as 'dark' | 'light'))}

		<div>
			<div class="text-faint mb-2 text-[11px] font-semibold tracking-wide uppercase">Syntax theme</div>
			<div class="grid grid-cols-2 gap-2">
				{#each THEMES as t (t.id)}
					{@const pp = appTheme === 'dark' ? t.dark : t.light}
					<button
						type="button"
						onclick={() => (themeId = t.id)}
						class="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors {themeId ===
						t.id
							? 'border-flame text-fg'
							: 'border-line text-dim hover:border-line-bright'}"
					>
						<span class="flex h-5 w-5 shrink-0 overflow-hidden rounded-md border border-black/20">
							<span class="flex-1" style="background:{pp.bg}"></span>
							<span class="w-1.5" style="background:{pp.tok.kw}"></span>
							<span class="w-1.5" style="background:{pp.tok.fn}"></span>
						</span>
						{t.label}
					</button>
				{/each}
			</div>
		</div>

		{@render segmented('View', viewMode, [
			{ id: 'split', label: 'Split' },
			{ id: 'unified', label: 'Unified' }
		], (v) => (viewMode = v as 'split' | 'unified'))}

		<div>
			<div class="text-faint mb-2 text-[11px] font-semibold tracking-wide uppercase">Code font</div>
			<div class="flex flex-col gap-1.5">
				{#each FONTS as f (f.id)}
					<button
						type="button"
						onclick={() => (fontId = f.id)}
						class="flex items-center justify-between rounded-lg border px-3 py-1.5 text-xs transition-colors {fontId ===
						f.id
							? 'border-flame text-fg'
							: 'border-line text-dim hover:border-line-bright'}"
						style="font-family: {f.stack}"
					>
						{f.label}
						{#if fontId === f.id}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-3.5 w-3.5 text-flame">
								<path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<label class="flex cursor-pointer items-center justify-between">
			<span class="text-fg text-sm font-medium">File icons</span>
			<button
				type="button"
				role="switch"
				aria-label="Toggle file icons"
				aria-checked={showIcons}
				onclick={() => (showIcons = !showIcons)}
				class="relative h-6 w-11 shrink-0 rounded-full transition-colors {showIcons
					? 'bg-flame'
					: 'bg-line-bright'}"
			>
				<span
					class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform {showIcons
						? 'translate-x-5'
						: ''}"
				></span>
			</button>
		</label>
	</div>

	<!-- Live preview -->
	<div class="border-line overflow-hidden rounded-2xl border shadow-2xl" style="background:{p.bg}">
		<div class="flex min-h-[420px]">
			<!-- File sidebar -->
			<aside
				class="hidden w-48 shrink-0 flex-col py-2 sm:flex"
				style="background:{p.gutter}; border-right:1px solid {p.lineNo}33"
			>
				<div class="px-3 py-2 text-[10px] font-semibold tracking-wide uppercase" style="color:{p.lineNo}">
					Changes · 4
				</div>
				{#each files as file (file.dir + file.name)}
					<div
						class="mx-1.5 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px]"
						style="background:{file.active ? p.addGutter : 'transparent'}; color:{file.active
							? p.fg
							: p.lineNo}"
					>
						{#if showIcons}
							{@render fileIcon(file.icon)}
						{/if}
						<span class="truncate" style="font-family:{font.stack}">{file.name}</span>
						<span class="ml-auto flex shrink-0 gap-1 text-[10px]">
							<span style="color:{p.addMark}">+{file.add}</span>
							<span style="color:{p.delMark}">−{file.del}</span>
						</span>
					</div>
				{/each}
			</aside>

			<!-- Diff -->
			<div class="min-w-0 flex-1 overflow-x-auto">
				<div
					class="flex items-center justify-between px-4 py-2.5 text-xs"
					style="border-bottom:1px solid {p.lineNo}33; color:{p.lineNo}; font-family:{font.stack}"
				>
					<span>src/auth/<span style="color:{p.fg}">session.ts</span></span>
					<span class="flex gap-2">
						<span style="color:{p.addMark}">+3</span>
						<span style="color:{p.delMark}">−2</span>
					</span>
				</div>

				<div class="text-[12.5px] leading-6" style="color:{p.fg}; font-family:{font.stack}">
					{#if viewMode === 'unified'}
						{#each lines as line (line.kind + (line.o ?? '') + (line.n ?? ''))}
							<div class="flex items-stretch" style="background:{bgFor(line.kind)}">
								<span
									class="w-9 shrink-0 px-1.5 text-right select-none"
									style="color:{p.lineNo}; background:{gutterFor(line.kind)}"
								>{line.o ?? ''}</span>
								<span
									class="w-9 shrink-0 px-1.5 text-right select-none"
									style="color:{p.lineNo}; background:{gutterFor(line.kind)}"
								>{line.n ?? ''}</span>
								<span class="w-4 shrink-0 text-center select-none" style="color:{markFor(line.kind)}"
								>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}</span>
								<code class="flex-1 pr-3 whitespace-pre">{@render toks(line.toks)}</code>
							</div>
						{/each}
					{:else}
						{#each splitRows as row, i (i)}
							<div class="flex">
								{@render splitCell(row.left)}
								<span class="w-px shrink-0" style="background:{p.lineNo}33"></span>
								{@render splitCell(row.right)}
							</div>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

{#snippet toks(list: Tok[])}{#each list as [text, kind], i (i)}<span style="color:{p.tok[kind]}">{text}</span>{/each}{/snippet}

{#snippet splitCell(line?: Line)}
	<div class="flex min-w-0 flex-1 items-stretch" style="background:{line ? bgFor(line.kind) : p.gutter + '40'}">
		<span
			class="w-9 shrink-0 px-1.5 text-right select-none"
			style="color:{p.lineNo}; background:{line ? gutterFor(line.kind) : 'transparent'}"
		>{line ? (line.o ?? line.n ?? '') : ''}</span>
		<span class="w-4 shrink-0 text-center select-none" style="color:{line ? markFor(line.kind) : 'transparent'}"
		>{line?.kind === 'add' ? '+' : line?.kind === 'del' ? '−' : ''}</span>
		<code class="min-w-0 flex-1 overflow-hidden pr-2 whitespace-pre">{#if line}{@render toks(line.toks)}{/if}</code>
	</div>
{/snippet}

{#snippet segmented(
	label: string,
	value: string,
	options: { id: string; label: string }[],
	set: (v: string) => void
)}
	<div>
		<div class="text-faint mb-2 text-[11px] font-semibold tracking-wide uppercase">{label}</div>
		<div class="border-line bg-base/50 flex gap-1 rounded-lg border p-1">
			{#each options as opt (opt.id)}
				<button
					type="button"
					onclick={() => set(opt.id)}
					class="flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors {value === opt.id
						? 'bg-elevated text-fg shadow'
						: 'text-dim hover:text-fg'}"
				>
					{opt.label}
				</button>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet fileIcon(kind: string)}
	{#if kind === 'ts'}
		<span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-[#3178c6] text-[8px] font-bold text-white">TS</span>
	{:else if kind === 'json'}
		<svg viewBox="0 0 24 24" fill="none" stroke="#f7df1e" stroke-width="2" class="h-3.5 w-3.5 shrink-0">
			<path d="M8 4H6a2 2 0 00-2 2v3a2 2 0 01-2 2 2 2 0 012 2v3a2 2 0 002 2h2M16 4h2a2 2 0 012 2v3a2 2 0 002 2 2 2 0 00-2 2v3a2 2 0 01-2 2h-2" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
	{:else}
		<span class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] bg-[#519aba] text-[7px] font-bold text-white">M↓</span>
	{/if}
{/snippet}
