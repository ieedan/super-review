# Publishing the desktop app

The desktop app ships as a GitHub Release built by CI for **Windows (x64)** and
**macOS (Apple silicon / arm64)**. Versioning, changelogs and releases are
driven by [changesets](https://github.com/changesets/changesets) and the
[`Release`](.github/workflows/release.yml) workflow; the builds themselves are
produced by [electron-builder](https://www.electron.build/), and the app
auto-updates from those releases via
[electron-updater](https://www.electron.build/auto-update).

## Artifacts

Each release contains:

| Platform    | Artifact                               | Purpose                   |
| ----------- | -------------------------------------- | ------------------------- |
| macOS arm64 | `Super-Review-<version>-arm64.dmg`     | Manual download / install |
| macOS arm64 | `Super-Review-<version>-arm64-mac.zip` | Auto-update payload       |
| macOS arm64 | `latest-mac.yml`                       | Auto-update feed          |
| Windows x64 | `Super-Review-Setup-<version>.exe`     | NSIS installer            |
| Windows x64 | `latest.yml`                           | Auto-update feed          |

## Workflow: how a release happens

1. **Describe your change.** In any PR that should affect the released app, add a
   changeset:

   ```bash
   pnpm changeset
   ```

   Pick the bump (`patch` / `minor` / `major`) and write a one-line summary. This
   creates a markdown file under `.changeset/` — commit it with your PR. PRs
   without a changeset don't trigger a release.

2. **Merge to `main`.** The [`Release`](.github/workflows/release.yml) workflow
   collects all pending changesets and opens (or updates) a
   **`chore(release): version desktop app`** PR. That PR bumps
   `apps/desktop/package.json` and regenerates `apps/desktop/CHANGELOG.md`.

3. **Merge the Version PR.** Merging it bumps the version on `main`, and the same
   workflow then:
   - builds on a macOS arm64 runner and a Windows runner via electron-builder,
     uploading all artifacts to a **draft** GitHub Release;
   - pushes the `v<version>` tag at the built commit and publishes the release.

   The published release is what electron-updater serves to existing installs.

You can re-run the workflow manually from the Actions tab
(`workflow_dispatch`) against the current `main` commit.

> **Note:** the release gate keys off the `v<version>` git tag. A push to `main`
> only triggers a build when `apps/desktop/package.json`'s version has no
> matching tag yet (i.e. right after a Version PR merge). Routine pushes are
> no-ops for the build/publish jobs.

## One-time setup (already done / for reference)

When this workflow was first adopted, two things were needed:

1. **Enable** Settings → Actions → General → "Allow GitHub Actions to create and
   approve pull requests" — so changesets can open the Version PR.

2. **Seed a baseline `v0.0.1` tag** so the gate doesn't treat the already-shipped
   `0.0.1` as un-released and rebuild it. Push this **only after the changesets
   workflow is on `main`** (the previous tag-triggered workflow would otherwise
   fire on the tag):

   ```bash
   git tag v0.0.1 <commit that shipped 0.0.1> && git push origin v0.0.1
   ```

## Code signing & notarization (optional)

Without signing secrets the workflow still produces installable (but unsigned)
builds. Users will see a Gatekeeper / SmartScreen warning, and **macOS
auto-updates require a signed build**. To ship signed, notarized builds, add
these repository secrets (Settings → Secrets and variables → Actions):

**macOS**

| Secret                        | Value                                          |
| ----------------------------- | ---------------------------------------------- |
| `MAC_CSC_LINK`                | base64 of your Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD`        | password for that `.p12`                       |
| `APPLE_ID`                    | Apple ID email for notarization                |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that Apple ID        |
| `APPLE_TEAM_ID`               | your Apple Developer Team ID                   |

**Windows**

| Secret                 | Value                              |
| ---------------------- | ---------------------------------- |
| `WIN_CSC_LINK`         | base64 of your code-signing `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | password for that `.pfx`           |

Notarization runs automatically once the macOS build is signed and the `APPLE_*`
secrets are present.

> The workflow also needs **Settings → Actions → General → "Allow GitHub Actions
> to create and approve pull requests"** enabled so changesets can open the
> Version PR.

## Building locally

```bash
pnpm package       # build distributables into apps/desktop/release (no upload)
pnpm package:dir   # unpacked build, faster for smoke tests
```

`pnpm release` is the publishing variant CI runs (`electron-builder --publish
always`); it needs `GH_TOKEN` set and is normally only invoked in CI.
