# Publishing the desktop app

The desktop app ships as a GitHub Release built by CI for **Windows (x64)** and
**macOS (Apple silicon / arm64)**. Releases are produced by
[`.github/workflows/release.yml`](.github/workflows/release.yml) using
[electron-builder](https://www.electron.build/), and the app auto-updates from
those releases via [electron-updater](https://www.electron.build/auto-update).

## Artifacts

Each release contains:

| Platform    | Artifact                               | Purpose                   |
| ----------- | -------------------------------------- | ------------------------- |
| macOS arm64 | `Super-Review-<version>-arm64.dmg`     | Manual download / install |
| macOS arm64 | `Super-Review-<version>-arm64-mac.zip` | Auto-update payload       |
| macOS arm64 | `latest-mac.yml`                       | Auto-update feed          |
| Windows x64 | `Super-Review-Setup-<version>.exe`     | NSIS installer            |
| Windows x64 | `latest.yml`                           | Auto-update feed          |

## Cutting a release

1. Bump the version in `apps/desktop/package.json` (the Git tag must match it):

   ```bash
   cd apps/desktop
   npm version patch --no-git-tag-version   # or minor / major
   ```

2. Commit the bump and tag it `v<version>` (e.g. `v0.1.0`):

   ```bash
   git commit -am "release: v0.1.0"
   git tag v0.1.0
   git push origin main --tags
   ```

3. Pushing the tag triggers **Release Desktop**, which builds on a macOS arm64
   runner and a Windows runner and uploads everything to a GitHub Release named
   for the tag.

You can also re-run the workflow manually from the Actions tab (`workflow_dispatch`).

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

## Building locally

```bash
pnpm package       # build distributables into apps/desktop/release (no upload)
pnpm package:dir   # unpacked build, faster for smoke tests
```

`pnpm release` is the publishing variant CI runs (`electron-builder --publish
always`); it needs `GH_TOKEN` set and is normally only invoked in CI.
