import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { changesetFilesWritten, getChangesetBrief, readChangesetFiles } from './changesets.js';

// Coverage for the two halves of an agent-written changeset run: the brief it is
// handed before it goes and looks (which packages it may name, where the branch
// starts, what is already covered), and reading back what it wrote by comparing
// the `.changeset` directory either side of the run.

let repo: string;
let git: SimpleGit;

async function write(rel: string, contents: string): Promise<void> {
	const abs = path.join(repo, rel);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, contents);
}

beforeEach(async () => {
	repo = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-changeset-gen-'));
	git = simpleGit(repo);
	await git.init();
	// Pin the initial branch name so the base branch is the same everywhere,
	// whatever the machine's init.defaultBranch is.
	await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
	await git.addConfig('user.email', 'test@example.com');
	await git.addConfig('user.name', 'Test');

	await write('.changeset/config.json', JSON.stringify({ baseBranch: 'main', ignore: [] }));
	await write('pnpm-workspace.yaml', 'packages:\n  - "packages/*"\n');
	await write('packages/a/package.json', JSON.stringify({ name: 'pkg-a', version: '1.0.0' }));
	await write('packages/a/src.ts', 'export const a = 1;\n');
	await write('packages/b/package.json', JSON.stringify({ name: 'pkg-b', version: '1.0.0' }));
	await git.add('.');
	await git.commit('init');

	// A branch that edits one package and already carries a changeset for it.
	await git.checkoutLocalBranch('feature');
	await write('packages/a/src.ts', 'export const a = 2;\n');
	await write('.changeset/tidy-otters-jog.md', "---\n'pkg-a': patch\n---\n\nbump a\n");
	await git.add('.');
	await git.commit('edit a');
});

afterEach(async () => {
	await fs.rm(repo, { recursive: true, force: true });
});

describe('getChangesetBrief', () => {
	it('names the releasable packages, the base, and what is already covered', async () => {
		const brief = await getChangesetBrief(repo);
		expect(brief).not.toBeNull();
		if (!brief) return;

		expect(brief.packages.map((p) => p.name)).toEqual(['pkg-a', 'pkg-b']);
		expect(brief.baseRef).toBe('main');
		expect(brief.mergeBase).toMatch(/^[0-9a-f]{40}$/);
		expect(brief.branchChangesets).toEqual([
			{ path: '.changeset/tidy-otters-jog.md', packages: ['pkg-a'] }
		]);
		// pkg-a's change is covered by the changeset already on the branch, so the
		// finish line is empty until something else changes.
		expect(brief.uncoveredPackages).toEqual([]);
	});

	it('lists a changed package that no changeset covers yet', async () => {
		await write('packages/b/src.ts', 'export const b = 1;\n');
		const brief = await getChangesetBrief(repo);
		expect(brief?.uncoveredPackages).toEqual(['pkg-b']);
	});

	it('returns null for a repo that does not use changesets', async () => {
		await fs.rm(path.join(repo, '.changeset'), { recursive: true, force: true });
		expect(await getChangesetBrief(repo)).toBeNull();
	});
});

describe('reading back what a run wrote', () => {
	it('reports files the run added or rewrote, and ignores untouched ones', async () => {
		const before = await readChangesetFiles(repo);
		expect([...before.keys()]).toEqual(['.changeset/tidy-otters-jog.md']);

		// Stand in for the agent: one new changeset, one rewritten, one untouched.
		await write('.changeset/brave-lions-sing.md', "---\n'pkg-b': minor\n---\n\nfeat(b): add b\n");
		await write(
			'.changeset/tidy-otters-jog.md',
			"---\n'pkg-a': minor\n---\n\nfeat(a): rewrite of the original\n"
		);
		await write('.changeset/README.md', 'not a changeset\n');

		const written = changesetFilesWritten(before, await readChangesetFiles(repo));
		expect(written.map((f) => f.path)).toEqual([
			'.changeset/brave-lions-sing.md',
			'.changeset/tidy-otters-jog.md'
		]);
		expect(written[0].packages).toEqual(['pkg-b']);
		expect(written[1].packages).toEqual(['pkg-a']);
	});

	it('reports nothing when the run wrote nothing', async () => {
		const before = await readChangesetFiles(repo);
		expect(changesetFilesWritten(before, await readChangesetFiles(repo))).toEqual([]);
	});
});
