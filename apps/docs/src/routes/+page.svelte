<script lang="ts">
	import PackageHoverDemo from '$lib/demos/PackageHoverDemo.svelte';
	import AccountSwitcherDemo from '$lib/demos/AccountSwitcherDemo.svelte';
	import DiffCustomizeDemo from '$lib/demos/DiffCustomizeDemo.svelte';

	// Downloads aren't live yet, so the CTAs are disabled "Coming soon" placeholders
	// until the first public release. Re-enable by restoring the download <a>'s
	// (OS detection + DOWNLOADS still live in $lib/releases.ts).

	// ── App preview ────────────────────────────────────────────────────────
	// Real product screenshot in static/. Set to null to fall back to the mini
	// mockup snippet below. Swap the file (or this path) to update the image.
	const screenshot: string | null = '/app-preview.webp';

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
	<title>Super Review: a faster, saner way to review agent-written code</title>
	<meta
		name="description"
		content="A local-first desktop app designed to structure and review agent-written code."
	/>
	<link rel="canonical" href="https://superreview.dev/" />

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Super Review" />
	<meta property="og:url" content="https://superreview.dev/" />
	<meta property="og:title" content="Super Review: review agent-written code" />
	<meta
		property="og:description"
		content="A local-first desktop app designed to structure and review agent-written code."
	/>
	<meta property="og:image" content="https://superreview.dev/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta
		property="og:image:alt"
		content="Super Review: a faster, saner way to review agent-written code"
	/>

	<!-- Twitter / X -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Super Review: review agent-written code" />
	<meta
		name="twitter:description"
		content="A local-first desktop app designed to structure and review agent-written code."
	/>
	<meta name="twitter:image" content="https://superreview.dev/og.png" />
</svelte:head>

<div class="atmosphere"><div class="grid-bg"></div></div>
<div class="grain"></div>

<div class="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6">
	<!-- Nav -->
	<header class="flex items-center justify-between py-5">
		<a href="/" class="flex items-center gap-2.5">
			<img src="/icon.png" alt="" class="h-8 w-8 rounded-lg shadow-lg" />
			<span class="font-display text-lg font-bold tracking-tight">Super Review</span>
		</a>
		<span
			class="border-line inline-flex cursor-default items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold text-dim"
			aria-disabled="true"
			title="Downloads coming soon"
		>
			<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-flame"></span>
			Coming soon
		</span>
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
			class="reveal mt-6 max-w-xl text-lg leading-relaxed text-pretty text-dim"
			style="animation-delay: 180ms"
		>
			A local-first desktop app designed to structure and review agent-written code.
		</p>

		<!-- Download (coming soon; see note in <script>) -->
		<div class="reveal mt-9 flex flex-col items-center gap-3" style="animation-delay: 260ms">
			<span
				class="border-line bg-elevated/60 inline-flex cursor-default items-center gap-3 rounded-xl border px-7 py-4 font-semibold text-dim"
				aria-disabled="true"
			>
				<span class="h-2 w-2 animate-pulse rounded-full bg-flame"></span>
				<span class="flex flex-col items-start leading-tight">
					<span class="text-fg">Downloads coming soon</span>
					<span class="text-faint text-xs font-normal">macOS & Windows</span>
				</span>
			</span>
			<!-- <div class="text-faint flex flex-wrap items-center justify-center gap-x-3 font-mono text-xs">
				<a href="https://github.com/{REPO}" class="transition-colors hover:text-flame">
					Star on GitHub
				</a>
			</div> -->
		</div>

		<!-- App preview -->
		<div class="reveal mt-14 w-full max-w-5xl pb-16" style="animation-delay: 340ms">
			<div
				class="pointer-events-none absolute left-1/2 -z-10 h-72 w-[80%] -translate-x-1/2 opacity-60"
				style="background: radial-gradient(50% 60% at 50% 40%, hsl(11 100% 60% / 0.22), transparent 70%); filter: blur(30px);"
			></div>

			<div
				class="bg-elevated/85 overflow-hidden rounded-2xl text-left shadow-2xl backdrop-blur-sm"
				style="box-shadow: 0 50px 120px -40px hsl(6 88% 40% / 0.5);"
			>
				{#if screenshot}
					<img src={screenshot} alt="Super Review app preview" class="block w-full" />
				{:else}
					{@render miniApp()}
				{/if}
			</div>
		</div>
	</main>

	<!-- ── Interactive feature showcase ──────────────────────────────────────
	     Live, in-browser recreations of three app features. Each demo is a
	     self-contained component under $lib/demos. -->
	<section class="flex flex-col gap-28 pt-12 pb-28 sm:pt-20">
		<!-- Section intro -->
		<div class="text-center">
			<span
				class="border-line bg-elevated/60 text-dim inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold tracking-wide"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-flame"></span>
				Try it right here
			</span>
			<h2 class="font-display mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl">
				Built for the way you actually review
			</h2>
			<p class="text-dim mx-auto mt-4 max-w-xl text-pretty">
				These aren't screenshots. They're the real components — go ahead and poke at them.
			</p>
		</div>

		<!-- Feature 1: package.json hover -->
		<div class="feature">
			{@render eyebrow('Dependencies', '01')}
			<div class="grid items-center gap-10 lg:grid-cols-2">
				<div>
					<h3 class="font-display text-2xl font-bold tracking-tight sm:text-3xl">
						Know what changed <span class="flame-text">before you trust it</span>
					</h3>
					<p class="text-dim mt-4 leading-relaxed text-pretty">
						When an agent bumps a dependency, hover the name in <code class="text-fg font-mono text-sm">package.json</code>
						to pull live npm metadata and GitHub release notes inline — version, license, links,
						and the full <em>"what's new"</em> changelog. No more tab-hopping to figure out if a
						version bump is safe.
					</p>
					<p class="text-faint mt-4 font-mono text-xs">↓ hover any highlighted package below</p>
				</div>
				<PackageHoverDemo />
			</div>
		</div>

		<!-- Feature 2: account management -->
		<div class="feature">
			{@render eyebrow('Accounts', '02')}
			<div class="grid items-center gap-10 lg:grid-cols-2">
				<div class="lg:order-2">
					<h3 class="font-display text-2xl font-bold tracking-tight sm:text-3xl">
						Every account, <span class="flame-text">one click away</span>
					</h3>
					<p class="text-dim mt-4 leading-relaxed text-pretty">
						Personal, work, and bot accounts live side by side. Pick a per-project default,
						switch who you're reviewing as, and Super Review tells you the moment a token
						expires — so a SAML lapse never silently swallows your comments.
					</p>
					<p class="text-faint mt-4 font-mono text-xs">→ open the switcher</p>
				</div>
				<div class="flex justify-center lg:order-1">
					<AccountSwitcherDemo />
				</div>
			</div>
		</div>

		<!-- Feature 3: diff customization -->
		<div class="feature">
			{@render eyebrow('Make it yours', '03')}
			<div class="mb-8 max-w-2xl">
				<h3 class="font-display text-2xl font-bold tracking-tight sm:text-3xl">
					Tune the diff until it <span class="flame-text">disappears into the work</span>
				</h3>
				<p class="text-dim mt-4 leading-relaxed text-pretty">
					Light or dark, split or unified, your favorite syntax theme and code font, file icons
					on or off. Set it once and read code the way your eyes prefer. Change anything on the
					left — the diff updates instantly.
				</p>
			</div>
			<DiffCustomizeDemo />
		</div>
	</section>

	<!-- Footer -->
	<footer
		class="border-line text-faint mt-auto flex flex-col items-center justify-between gap-4 border-t py-8 text-sm sm:flex-row"
	>
		<div class="flex items-center gap-2.5">
			<img src="/icon.png" alt="" class="h-6 w-6 rounded-md" />
			<span>Super Review</span>
		</div>
		<div class="flex items-center gap-5">
			<!-- <a href="https://github.com/{REPO}" class="hover:text-fg transition-colors">GitHub</a> -->
			<!-- <a href={RELEASES_URL} class="hover:text-fg transition-colors">Releases</a> -->
		</div>
	</footer>
</div>

<!-- ── snippets ─────────────────────────────────────────────────────────── -->

{#snippet eyebrow(label: string, num: string)}
	<div class="mb-6 flex items-center gap-3">
		<span class="font-display text-flame/40 text-sm font-bold">{num}</span>
		<span class="bg-flame/30 h-px w-8"></span>
		<span class="text-faint text-xs font-semibold tracking-[0.2em] uppercase">{label}</span>
	</div>
{/snippet}

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
									: 'text-dim'}"
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
						<span class="text-dim">src/auth/<span class="text-fg">session.ts</span></span>
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
										: 'text-dim'}">{line.text}</code
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
