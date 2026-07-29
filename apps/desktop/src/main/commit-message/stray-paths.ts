import { simpleGit } from 'simple-git';

// Every path git considers changed right now (modified, staged, or untracked),
// as repo-relative posix paths. Taken either side of an agent run so we can tell
// what it touched from what was already dirty — the prompt is what keeps a run
// inside `.changeset/`, and this is how we find out whether it listened.
export async function listDirtyPaths(repoPath: string): Promise<Set<string>> {
	const paths = new Set<string>();
	try {
		const status = await simpleGit(repoPath).raw(['status', '--porcelain', '-z']);
		for (const entry of status.split('\0')) {
			// `XY <path>`; a rename is `R  <new>\0<old>`, and the old path arrives as
			// its own (pathless) entry, which the length check drops.
			if (entry.length > 3) paths.add(entry.slice(3));
		}
	} catch {
		// No git, or a repo in a state git won't report on: with nothing to compare
		// against, claim nothing rather than accusing the agent of everything.
	}
	return paths;
}
