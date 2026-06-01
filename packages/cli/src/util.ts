import { simpleGit } from 'simple-git';

// Print a one-line error and exit non-zero. Typed `never` so callers can use it
// in expression position without TypeScript losing the control-flow narrowing.
export function fail(message: string): never {
	console.error(`error: ${message}`);
	process.exit(1);
}

// Resolve the git top-level for a working directory, failing with a clear
// message when it isn't a repo (sessions are always written at the repo root).
export async function repoRoot(cwd: string): Promise<string> {
	try {
		const top = await simpleGit(cwd).revparse(['--show-toplevel']);
		return top.trim();
	} catch {
		fail(`not a git repository: ${cwd}`);
	}
}
