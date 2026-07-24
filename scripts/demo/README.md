# Demo repo seeder

Builds `ledger`, a fabricated SvelteKit expense-splitter repo, and leaves it in
exactly the state a launch-video take starts from. One command per scene, and
every scene is a clean rebuild, so takes are retryable without any git surgery.

## Usage

```sh
pnpm build:cli                 # the seeder drives the freshly built CLI
pnpm demo:seed --scene tour --force
```

The repo is built at `../ledger` (a sibling of this monorepo under the same
`github/` folder, named after the project so it reads like a real repo on
camera). Override with `--out <path>`. `--force` is required to rebuild an
existing demo repo, and it refuses to touch any directory that is not a demo repo
the seeder created (it looks for a `.ledger-demo` marker).

Then in Super Review: add the `../ledger` repo and follow the on-camera steps the
seeder prints.

## Scenes

| `--scene`  | Branch           | Shows off                                         |
| ---------- | ---------------- | ------------------------------------------------- |
| `skills`   | `main`           | "Configure AI files" installing the skills        |
| `tour`     | `feat/settle-up` | A committed guided tour with callouts             |
| `comments` | `feat/settle-up` | Leaving review comments, then `/resolve-comments` |
| `tasks`    | `feat/recurring` | A committed task list, then `/loop-tasks`         |
| `staging`  | `feat/settle-up` | Hunk staging a mixed dirty tree                   |

Polish surfaces ride along inside these: mark-as-seen and find-in-diff in the
tour, an image diff on `static/og.png`, package hover cards on the `date-fns` /
`zod` additions in `package.json`, split vs unified on `settle.ts`, and the
changeset button (the repo carries `.changeset/`).

### `comments` rehearsal

Comments live in the per-machine application database
(`~/.super-review/comments.db`), keyed by the repo's absolute path, so they
cannot ship inside the repo. The real take should leave them **live** (writing
them on camera is the point). For a dry run, `--seed-comments` prewrites the four
planted comments so you can jump straight to the resolve step:

```sh
pnpm demo:seed --scene comments --force --seed-comments
```

## What is planted

`feat/settle-up` carries four defensible review targets, so a `/resolve-comments`
run produces real fixes rather than theater:

- `src/lib/settle.ts` launders an already-integer cent value through floats.
- `src/lib/split.ts` rounds each weighted share independently, so parts can miss
  the total by a cent.
- `src/lib/money.ts` silently truncates a third decimal in `parseAmount`.
- `src/lib/components/SettleUpSheet.svelte` has an unkeyed `{#each}`.

The committed tests pass on `feat/settle-up` (the bugs are subtle enough that the
shipped fixtures do not trip them), so the demo repo never shows red.

## Layout

```
scripts/demo/
  seed.ts            CLI entry: --scene, --out, --force, --seed-comments
  build.ts           builds main + feat/settle-up (with tour) + feat/recurring
  seed-comments.ts   optional: writes the review comments into the app database
  lib.ts             git/CLI runners and the fixture copy helper
  fixtures/ledger/
    base/            files at the main baseline
    settle-up/       overlay applied on feat/settle-up
    dirty/           working-tree overlay for the staging scene
  tours/settle-up.json   the guided tour document passed to `session save`
  tasks/recurring.json   the feat/recurring task list
```

Fixture files that must ship as dotfiles are stored with a `_dot_` prefix
(`_dot_gitignore`, `_dot_changeset/`) and restored on copy, so git and npm do not
swallow them inside this monorepo.
