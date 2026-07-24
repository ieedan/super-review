<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<div class="shell">
	<header class="topbar">
		<a class="brand" href="/">
			<img src="/logo.svg" alt="" width="22" height="22" />
			<span>Ledger</span>
		</a>
		<span class="tagline">Split shared expenses without doing arithmetic at the table</span>
	</header>

	<main>
		{@render children?.()}
	</main>
</div>

<style>
	.shell {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 4rem;
	}

	.topbar {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding-bottom: 1.25rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		font-weight: 700;
		font-size: 1.05rem;
		color: inherit;
		text-decoration: none;
	}

	.tagline {
		font-size: 0.8rem;
		color: var(--muted);
	}

	main {
		display: grid;
		gap: 1rem;
	}
</style>
