# @super-review/docs

The marketing site and download page for [Super Review](../desktop). Built with
SvelteKit + Tailwind v4 and prerendered to static HTML via
[`@sveltejs/adapter-static`](https://svelte.dev/docs/kit/adapter-static), so it
can be hosted anywhere (GitHub Pages, a CDN, object storage).

## Develop

From the repo root:

```sh
pnpm --filter @super-review/docs dev
```

## Build

```sh
pnpm --filter @super-review/docs build   # outputs to apps/docs/build/
```

## How downloads work

The release artifacts ship under **stable, version-less filenames** (set in
[`apps/desktop/electron-builder.yml`](../desktop/electron-builder.yml) via
`dmg.artifactName` / `nsis.artifactName`):

- macOS (Apple silicon): `Super-Review-mac-arm64.dmg`
- Windows (x64): `Super-Review-win-x64.exe`

The buttons link to `github.com/ieedan/super-review/releases/latest/download/<name>`,
which 302-redirects to the newest release's matching asset and serves it with
`Content-Disposition: attachment` — so a click **downloads the binary directly**,
always the latest, with no API call. `src/lib/releases.ts` only sniffs the OS to
pick which button leads. The version pill is a best-effort label from the API and
is purely cosmetic.

> **Note:** these stable filenames take effect on the **next** release. The
> current `v0.0.4` assets still carry version-stamped names, so the buttons 404
> until a build with `electron-builder.yml`'s `artifactName` is published (a
> changeset for this is already staged). And while `ieedan/super-review` is a
> **private** repo, the links resolve only for visitors authenticated to it.
