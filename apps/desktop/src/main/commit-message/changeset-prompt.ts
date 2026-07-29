import type { ChangesetBrief } from '@super-review/core';
import { DEFAULT_CHANGESET_BASE_PROMPT } from '@super-review/core/changeset-prompt';

export { DEFAULT_CHANGESET_BASE_PROMPT };

export interface ChangesetPromptInput {
	branch: string | null;
	brief: ChangesetBrief;
	// The user's instructions: what a changeset should read like. Empty/whitespace
	// falls back to DEFAULT_CHANGESET_BASE_PROMPT.
	basePrompt?: string | null;
}

// The prompt hands over a job, not a diff. The agent is running inside the repo
// with its own tools, so it can read the branch far better than we can paste it:
// what goes in here is only what it can't work out for itself (which packages
// this workspace actually releases, where the branch starts, what is already
// covered) and the boundaries of the job (write changesets, touch nothing else).
export function buildChangesetPrompt(input: ChangesetPromptInput): string {
	const { brief } = input;
	const style = input.basePrompt?.trim() || DEFAULT_CHANGESET_BASE_PROMPT;
	const base = brief.mergeBase ?? brief.baseRef;

	return [
		'Write the changesets for the work on this branch. You are running inside the repository.',
		'',
		`Branch: ${input.branch ?? '(detached)'}`,
		base
			? `Base: ${brief.baseRef ?? 'the default branch'} (this branch starts at ${base})`
			: 'Base: none found — treat the working tree as the change.',
		'',
		'Releasable packages, the only names a changeset may reference:',
		describePackages(brief),
		'',
		'Changesets already on this branch:',
		describeExisting(brief),
		'',
		'Still uncovered — these packages have changes on this branch that no changeset accounts for yet:',
		brief.uncoveredPackages.length ? brief.uncoveredPackages.join('\n') : '(none)',
		'The job is done when every one of them is covered. Find what changed in each and give it a changeset; a package with a real change in it never gets left out, however small the change looks.',
		'',
		'Work out what changed for yourself, and take the time to do it properly.',
		base
			? `Everything since ${base} is in scope, committed or not. Committed work and uncommitted work are equally part of this branch, and they are often different features — read the commit log, the diff against the base, and the uncommitted and untracked files as three separate passes, and open whatever files you need to understand what each one actually does.`
			: 'The working tree is the change: read the diff and the untracked files, and open whatever files you need to understand what the change actually does.',
		'Before writing anything, list for yourself every distinct piece of work you found and which packages each one touched. A branch often carries more than one, and the ones that matter are not always the ones with the most lines. Then write the changesets from that list.',
		'',
		'How to write them:',
		style,
		'',
		'Then write the files yourself, one per changeset, as `.changeset/<a-slug-like-this>.md`:',
		'---',
		"'<package>': patch | minor | major",
		'---',
		'',
		'<summary>',
		'',
		'Rules:',
		'- Every piece of work on the branch that no listed changeset already covers needs one. Work committed earlier on the branch counts exactly as much as what is sitting uncommitted right now — neither is more done than the other, and both ship in the same release.',
		'- Create and edit files inside `.changeset/` only. Change nothing else in the repository, and do not commit, stage, or run git commands that write.',
		'- Only reference packages from the list above, and only ones this branch actually changed.',
		'- Leave the changesets already listed above alone; write only what they do not cover.',
		'- Give each changeset its own file with a fresh slug; do not overwrite an existing one.',
		'',
		'Before you finish, check two things: every piece of work on your list has a changeset, and every package listed as uncovered above is named in one of them.',
		'When you are done, reply with one line naming the files you wrote. Nothing else.'
	].join('\n');
}

function describePackages(brief: ChangesetBrief): string {
	if (brief.packages.length === 0) return '(none)';
	return brief.packages
		.map((p) => `${p.name} (${p.dir || '.'})${p.private ? ' [private]' : ''}`)
		.join('\n');
}

function describeExisting(brief: ChangesetBrief): string {
	if (brief.branchChangesets.length === 0) return '(none)';
	return brief.branchChangesets
		.map((c) => `${c.path} covers ${c.packages.join(', ') || '(nothing)'}`)
		.join('\n');
}
