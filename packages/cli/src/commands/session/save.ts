import { Command } from 'commander';
import { runSliceSave } from '../slice/save';

// `session save` is a deprecated alias for `slice save`, kept for one release so
// existing agent scripts / AGENTS.md don't break the day slices land. It maps the
// old flags onto the slice command and prints a deprecation notice. The frozen
// content concerns (--committed/--base/--head) are gone — a slice always renders
// the branch's changes live — so those flags are accepted but ignored.
interface LegacySaveOptions {
	key?: string;
	id?: string;
	name?: string;
	description?: string;
	harness?: string;
	harnessLabel?: string;
	harnessUrl?: string;
	committed?: boolean;
	base?: string;
	head?: string;
	tour?: string;
	cwd?: string;
}

async function runSave(opts: LegacySaveOptions): Promise<void> {
	console.error(
		'warning: `session save` is deprecated and now creates a slice. Use `slice save` instead.'
	);
	if (opts.committed || opts.base || opts.head) {
		console.error(
			"note: --committed/--base/--head are ignored — a slice always renders the branch's\n" +
				'      changes (committed and uncommitted) live against its fork point.'
		);
	}
	await runSliceSave({
		key: opts.key,
		id: opts.id,
		// The old --name becomes the slice's --title.
		title: opts.name,
		description: opts.description,
		harness: opts.harness,
		tour: opts.tour,
		cwd: opts.cwd
	});
}

export const save = new Command('save')
	.description('[deprecated] alias for `slice save` — captures changes as a slice')
	.option('--key <id>', 'Stable upsert key (your harness conversation/run id).')
	.option('--id <id>', 'Target an existing slice by its id (alternative to --key).')
	.option('--name <text>', 'Slice title (required on first save). Maps to `slice save --title`.')
	.option('--description <text>', 'What you changed (required on first save).')
	.option('--harness <kind>', 'One of: claude-code, cursor, codex, opencode, copilot, other.')
	.option('--harness-label <text>', '[ignored] kept for flag compatibility.')
	.option('--harness-url <url>', '[ignored] kept for flag compatibility.')
	.option('--committed', '[ignored] slices always render live; see the deprecation note.')
	.option('--base <ref>', '[ignored] slices always render live; see the deprecation note.')
	.option('--head <ref>', '[ignored] slices always render live; see the deprecation note.')
	.option('--tour <json>', 'Inline JSON describing a guided tour (same shape as `slice save`).')
	.option('--cwd <path>', 'Repo path (default: current directory).')
	.action(runSave);
