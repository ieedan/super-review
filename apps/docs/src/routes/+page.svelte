<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import {
		detectOS,
		fetchLatestVersion,
		DOWNLOADS,
		LATEST_RELEASE_URL,
		RELEASES_URL,
		REPO,
		type OS
	} from '$lib/releases';

	let os = $state<OS>('other');
	let version = $state<string | null>(null);

	onMount(async () => {
		os = detectOS();
		// Display-only; the download links work regardless of whether this resolves.
		version = await fetchLatestVersion();
	});

	// Lead with the visitor's platform; the other one stays available as a
	// secondary option. Non-mac/windows visitors get macOS first.
	const primary = $derived(os === 'windows' ? DOWNLOADS.windows : DOWNLOADS.mac);
	const secondary = $derived(os === 'windows' ? DOWNLOADS.mac : DOWNLOADS.windows);

	// ── App preview ────────────────────────────────────────────────────────
	// To use a real screenshot later: drop the image in `static/` (e.g.
	// static/app-preview.png) and set this to its path, e.g. `${base}/app-preview.png`.
	// While it's null we render the mini mockup below in the same frame.
	const screenshot: string | null = null;

	const files = [
		{ name: 'src/auth/session.ts', add: 3, del: 2, active: true },
		{ name: 'src/api/client.ts', add: 12, del: 4, active: false },
		{ name: 'src/routes/+page.ts', add: 1, del: 0, active: false },
		{ name: 'README.md', add: 8, del: 1, active: false }
	];

	const diff = [
		{ n: '41', t: 'ctx', text: 'export async function authenticate(req: Request) {' },
		{ n: '42', t: 'del', text: '  const token = req.cookies.token' },
		{ n: '42', t: 'add', text: '  const token = await getSession(req)' },
		{ n: '43', t: 'ctx', text: '  if (!token) return unauthorized()' },
		{ n: '44', t: 'del', text: '  return decode(token)' },
		{ n: '44', t: 'add', text: '  return verify(token, env.SESSION_SECRET)' },
		{ n: '45', t: 'ctx', text: '}' }
	];
</script>

<svelte:head>
	<title>Super Review — a faster, saner way to review agent-written code</title>
	<meta
		name="description"
		content="Super Review is a local-first desktop app that turns sprawling agent diffs into a calm, reviewable flow. Free and open source for macOS and Windows."
	/>
	<meta property="og:title" content="Super Review" />
	<meta
		property="og:description"
		content="A faster, saner desktop app for reviewing agent-written code."
	/>
	<meta property="og:type" content="website" />
	<meta property="og:image" content="{base}/icon.png" />
	<meta name="twitter:card" content="summary" />
</svelte:head>

<div class="atmosphere"><div class="grid-bg"></div></div>
<div class="grain"></div>

<div class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6">
	<!-- Nav -->
	<header class="flex items-center justify-between py-5">
		<a href="/" class="flex items-center gap-2.5">
			<img src="{base}/icon.png" alt="" class="h-8 w-8 rounded-lg shadow-lg" />
			<span class="font-display text-lg font-bold tracking-tight">Super Review</span>
		</a>
		<a
			href={primary.url}
			download={primary.filename}
			class="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-[hsl(20_8%_6%)] transition-transform duration-150 hover:-translate-y-0.5"
			style="background-image: linear-gradient(135deg, var(--color-flame-soft), var(--color-flame-deep)); box-shadow: 0 6px 24px -8px hsl(11 100% 58% / 0.6);"
		>
			{@render downloadArrow('h-4 w-4')}
			Download
		</a>
	</header>

	<!-- Hero -->
	<main class="flex flex-1 flex-col items-center pt-16 text-center sm:pt-28">
		<h1
			class="reveal font-display max-w-3xl text-5xl leading-[1.03] font-extrabold tracking-tight text-balance sm:text-6xl"
			style="animation-delay: 40ms"
		>
			A faster, saner way to review
			<span class="flame-text">agent-written code.</span>
		</h1>

		<p
			class="reveal mt-6 max-w-xl text-lg leading-relaxed text-pretty text-muted"
			style="animation-delay: 180ms"
		>
			A local-first desktop app that turns sprawling agent diffs into a calm, reviewable flow — read
			every change, approve with confidence, and ship.
		</p>

		<!-- Download -->
		<div class="reveal mt-9 flex flex-col items-center gap-3" style="animation-delay: 260ms">
			<a
				href={primary.url}
				download={primary.filename}
				class="group inline-flex items-center gap-3 rounded-xl px-7 py-4 font-semibold text-[hsl(20_8%_6%)] transition-transform duration-150 hover:-translate-y-0.5"
				style="background-image: linear-gradient(135deg, var(--color-flame-soft), var(--color-flame-deep)); box-shadow: 0 10px 40px -10px hsl(11 100% 58% / 0.55);"
			>
				{@render osMark(primary.os, 'h-5 w-5')}
				<span class="flex flex-col items-start leading-tight">
					<span>Download for {primary.label}</span>
					<span class="text-xs font-normal opacity-80">{primary.arch}</span>
				</span>
				{@render downloadArrow('ml-1 h-4 w-4 transition-transform group-hover:translate-y-0.5')}
			</a>
			<div class="text-faint flex flex-wrap items-center justify-center gap-x-3 font-mono text-xs">
				<a
					href={secondary.url}
					download={secondary.filename}
					class="hover:text-flame transition-colors"
				>
					Also for {secondary.label}
				</a>
				<span aria-hidden="true">·</span>
				{#if version}
					<a href={LATEST_RELEASE_URL} class="hover:text-flame transition-colors">v{version}</a>
					<span aria-hidden="true">·</span>
				{/if}
				<span>Free &amp; open source</span>
			</div>
		</div>

		<!-- App preview -->
		<div class="reveal mt-14 w-full max-w-5xl pb-16" style="animation-delay: 340ms">
			<div
				class="pointer-events-none absolute left-1/2 -z-10 h-72 w-[80%] -translate-x-1/2 opacity-60"
				style="background: radial-gradient(50% 60% at 50% 40%, hsl(11 100% 60% / 0.22), transparent 70%); filter: blur(30px);"
			></div>

			<div
				class="border-line-bright bg-elevated/85 overflow-hidden rounded-2xl border text-left shadow-2xl backdrop-blur-sm"
				style="box-shadow: 0 50px 120px -40px hsl(6 88% 40% / 0.5), 0 0 0 1px hsl(28 9% 12%);"
			>
				{#if screenshot}
					<img src={screenshot} alt="Super Review app preview" class="block w-full" />
				{:else}
					{@render miniApp()}
				{/if}
			</div>
		</div>
	</main>

	<!-- Footer -->
	<footer
		class="border-line text-faint mt-auto flex flex-col items-center justify-between gap-4 border-t py-8 text-sm sm:flex-row"
	>
		<div class="flex items-center gap-2.5">
			<img src="{base}/icon.png" alt="" class="h-6 w-6 rounded-md" />
			<span>Super Review</span>
			<span class="text-line-bright">·</span>
			<span>MIT licensed</span>
		</div>
		<div class="flex items-center gap-5">
			<a href="https://github.com/{REPO}" class="hover:text-fg transition-colors">GitHub</a>
			<a href={RELEASES_URL} class="hover:text-fg transition-colors">Releases</a>
			<a href="https://github.com/{REPO}/blob/main/LICENSE" class="hover:text-fg transition-colors"
				>License</a
			>
		</div>
	</footer>
</div>

<!-- ── snippets ─────────────────────────────────────────────────────────── -->

{#snippet miniApp()}
	<!-- A miniature of the desktop app: file sidebar + diff panel. Replaced by a
	     real screenshot once `screenshot` above is set. -->
	<div class="aspect-[4/3] sm:aspect-[16/10]">
		<div class="flex h-full flex-col">
			<!-- Title bar -->
			<div class="border-line flex shrink-0 items-center gap-2 border-b px-4 py-3">
				<span class="h-3 w-3 rounded-full bg-[hsl(2_78%_63%)]"></span>
				<span class="h-3 w-3 rounded-full bg-[hsl(38_92%_60%)]"></span>
				<span class="h-3 w-3 rounded-full bg-[hsl(142_58%_52%)]"></span>
				<span class="text-faint ml-3 flex items-center gap-1.5 font-mono text-xs">
					{@render brandGlyph('h-3.5 w-3.5')} Super Review
				</span>
			</div>

			<div class="flex min-h-0 flex-1">
				<!-- File sidebar -->
				<aside class="border-line bg-base/40 hidden w-56 shrink-0 flex-col border-r sm:flex">
					<div class="text-faint px-4 py-3 font-mono text-[11px] tracking-wide uppercase">
						Changes · 4
					</div>
					<nav class="flex flex-col gap-0.5 px-2">
						{#each files as file (file.name)}
							<span
								class="flex items-center justify-between rounded-md px-2 py-1.5 {file.active
									? 'bg-elevated text-fg'
									: 'text-muted'}"
							>
								<span class="truncate font-mono text-xs">{file.name.split('/').pop()}</span>
								<span class="ml-2 flex shrink-0 gap-1 font-mono text-[10px]">
									<span class="text-add">+{file.add}</span>
									<span class="text-del">−{file.del}</span>
								</span>
							</span>
						{/each}
					</nav>
				</aside>

				<!-- Diff panel -->
				<div class="flex min-w-0 flex-1 flex-col">
					<div
						class="border-line bg-base/40 flex shrink-0 items-center justify-between border-b px-4 py-2.5 font-mono text-xs"
					>
						<span class="text-muted">src/auth/<span class="text-fg">session.ts</span></span>
						<span class="flex items-center gap-2">
							<span class="text-add">+3</span>
							<span class="text-del">−2</span>
						</span>
					</div>

					<div class="min-h-0 flex-1 overflow-hidden font-mono text-[12.5px] leading-relaxed">
						{#each diff as line (line.n + line.text)}
							<div
								class="flex items-stretch {line.t === 'add'
									? 'bg-add/10'
									: line.t === 'del'
										? 'bg-del/10'
										: ''}"
							>
								<span
									class="text-faint w-10 shrink-0 border-r px-2 text-right select-none {line.t ===
									'add'
										? 'border-add/40'
										: line.t === 'del'
											? 'border-del/40'
											: 'border-line'}"
								>
									{line.n}
								</span>
								<span
									class="w-5 shrink-0 text-center select-none {line.t === 'add'
										? 'text-add'
										: line.t === 'del'
											? 'text-del'
											: 'text-transparent'}"
								>
									{line.t === 'add' ? '+' : line.t === 'del' ? '−' : ''}
								</span>
								<code
									class="flex-1 py-0.5 pr-3 whitespace-pre {line.t === 'add'
										? 'text-fg'
										: 'text-muted'}">{line.text}</code
								>
							</div>
						{/each}
					</div>

					<div class="border-line flex shrink-0 items-center justify-between border-t px-4 py-3">
						<span class="text-faint font-mono text-xs">1 of 4 files reviewed</span>
						<span
							class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-[hsl(20_8%_6%)]"
							style="background-image: linear-gradient(135deg, var(--color-flame-soft), var(--color-flame-deep));"
						>
							{@render check('h-3.5 w-3.5')} Approve
						</span>
					</div>
				</div>
			</div>
		</div>
	</div>
{/snippet}

{#snippet osMark(o: 'mac' | 'windows', cls: string)}
	{#if o === 'mac'}
		<svg viewBox="0 0 384 512" fill="currentColor" class={cls} aria-hidden="true">
			<path
				d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
			/>
		</svg>
	{:else}
		<svg viewBox="0 0 448 512" fill="currentColor" class={cls} aria-hidden="true">
			<path
				d="M0 93.7l183.6-25.3v177.4H0V93.7zm0 324.6l183.6 25.3V268.4H0v149.9zm203.8 28L448 480V268.4H203.8v177.9zm0-380.6v180.1H448V32L203.8 65.7z"
			/>
		</svg>
	{/if}
{/snippet}

{#snippet downloadArrow(cls: string)}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		class={cls}
		aria-hidden="true"
	>
		<path d="M12 3v12m0 0l4-4m-4 4l-4-4M4 20h16" />
	</svg>
{/snippet}

{#snippet check(cls: string)}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		class={cls}
		aria-hidden="true"
	>
		<path d="M20 6L9 17l-5-5" />
	</svg>
{/snippet}

{#snippet brandGlyph(cls: string)}
	<svg viewBox="0 0 24 24" fill="none" class={cls} aria-hidden="true">
		<circle cx="10" cy="10" r="7" stroke="var(--color-flame)" stroke-width="2" />
		<path
			d="M15.5 15.5L21 21"
			stroke="var(--color-flame)"
			stroke-width="2"
			stroke-linecap="round"
		/>
		<path d="M10.5 5.5L7 11h3l-.5 3.5L13 9h-3l.5-3.5z" fill="var(--color-flame)" />
	</svg>
{/snippet}
