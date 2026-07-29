// Default instructions for AI changeset generation: the editorial half of the
// prompt, and the only half the user owns. Editable in Settings → Prompts and
// persisted in prefs.
//
// The app wraps this with the job itself (which packages are releasable, where
// the branch starts, which ones still need covering, write the files in
// `.changeset/` and nothing else). What a changeset should say, how it should
// read, and how the branch's work should be divided up between them is all here,
// so changing this actually changes the changesets you get.
export const DEFAULT_CHANGESET_BASE_PROMPT = `Describe the branch by what it adds to the release, not by how it was built. A changelog reader has never seen this branch's commits: to them the whole branch arrives at once, so a commit that fixes or extends something this same branch introduced is part of that feature, not a fix to it. Fold it in. Only work that changes something which already existed before the branch is a fix or a change of its own.

Write one changeset per distinct piece of work that leaves, each scoped to the packages that piece actually touched. Two unrelated features are two changesets; one feature spread across five packages, five commits, and a follow-up fix is still one changeset.

Each summary is a single line in the style of a conventional commit: \`type(scope): what changed\`. No body, no bullet list, no detail below it.`;
