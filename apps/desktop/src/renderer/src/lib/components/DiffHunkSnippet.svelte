<script lang="ts">
	// Renders a GitHub-style snapshot of a comment's code context straight from
	// the stored unified-diff hunk (REST `diff_hunk`) — never the working tree. We
	// use this for outdated comments, whose anchored line (or whole file) no longer
	// exists in the current diff, so there's nothing on disk to render from.

	interface Props {
		// The unified-diff hunk text, e.g.
		//   "@@ -10,7 +10,6 @@ fn foo()\n context\n-removed\n+added".
		hunk: string;
		// The original line the comment was placed on, used to emphasise the
		// matching row. Read against `side`'s line numbering.
		originalLine?: number | null;
		// Which side the comment lives on: RIGHT counts new-file lines, LEFT old.
		side?: 'LEFT' | 'RIGHT';
	}

	let { hunk, originalLine = null, side = 'RIGHT' }: Props = $props();

	type Row = {
		kind: 'header' | 'add' | 'del' | 'context';
		text: string;
		// The line number on the comment's side, when this row carries one.
		lineNo: number | null;
	};

	// Walk the hunk, tracking old/new line counters off the @@ header so we can
	// label rows and find the one the comment was anchored to. Mirrors how GitHub
	// renders the small diff preview above an outdated comment.
	const rows = $derived.by<Row[]>(() => {
		const out: Row[] = [];
		let oldNo = 0;
		let newNo = 0;
		for (const line of hunk.split('\n')) {
			if (line.startsWith('@@')) {
				// "@@ -oldStart,oldCount +newStart,newCount @@ …"
				const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
				if (m) {
					oldNo = Number(m[1]);
					newNo = Number(m[2]);
				}
				out.push({ kind: 'header', text: line, lineNo: null });
				continue;
			}
			const marker = line[0];
			const text = line.slice(1);
			if (marker === '+') {
				out.push({ kind: 'add', text, lineNo: newNo });
				newNo++;
			} else if (marker === '-') {
				out.push({ kind: 'del', text, lineNo: oldNo });
				oldNo++;
			} else if (marker === '\\') {
				// "\ No newline at end of file" — metadata, no line number.
				out.push({ kind: 'context', text: line, lineNo: null });
			} else {
				out.push({ kind: 'context', text, lineNo: newNo });
				oldNo++;
				newNo++;
			}
		}
		return out;
	});

	function isAnchor(row: Row): boolean {
		if (originalLine == null || row.lineNo !== originalLine) return false;
		// On the RIGHT, the anchor is an added/context row; on the LEFT, a
		// deleted/context row. Guard so we don't highlight the opposite side's
		// coincidentally-equal line number.
		return side === 'LEFT' ? row.kind !== 'add' : row.kind !== 'del';
	}
</script>

<pre class="hunk"><code
		>{#each rows as row, i (i)}<span
				class={['row', `row-${row.kind}`, isAnchor(row) && 'row-anchor']}
				>{#if row.kind === 'add'}+{:else if row.kind === 'del'}-{:else if row.kind === 'header'}{:else}&nbsp;{/if}{row.text}</span
			>{/each}</code
	></pre>

<style>
	.hunk {
		margin: 0;
		overflow-x: auto;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-background);
		font-family:
			ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
		font-size: 12px;
		line-height: 1.5;
	}
	.hunk code {
		display: block;
	}
	.row {
		display: block;
		white-space: pre;
		padding: 0 8px;
	}
	.row-header {
		color: var(--color-muted-foreground);
		background: color-mix(in srgb, var(--color-muted-foreground) 8%, transparent);
	}
	.row-add {
		background: color-mix(in srgb, var(--color-success) 12%, transparent);
		color: var(--color-foreground);
	}
	.row-del {
		background: color-mix(in srgb, var(--color-destructive) 12%, transparent);
		color: var(--color-foreground);
	}
	.row-context {
		color: var(--color-muted-foreground);
	}
	/* The line the comment was anchored to — a left rule echoes GitHub's emphasis
	   so the reader can tell which line the (now outdated) comment refers to. */
	.row-anchor {
		box-shadow: inset 3px 0 0 var(--color-warning);
		font-weight: 600;
	}
</style>
