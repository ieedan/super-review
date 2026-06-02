// electron-builder afterPack hook.
//
// When no Apple Developer ID is available (CSC_LINK unset), electron-builder
// skips macOS code signing entirely and ships a completely unsigned .app. On
// Apple Silicon the kernel refuses to launch unsigned binaries, which surfaces
// to users as the misleading "Super Review is damaged and can't be opened"
// Gatekeeper dialog.
//
// An ad-hoc signature (`codesign --sign -`) is enough to make the app launch.
// It is NOT notarized, so users still get the "unverified developer" prompt
// (right-click -> Open, or Open Anyway in System Settings) the first time, but
// the dead-end "damaged" error goes away.
//
// This hook is a no-op when:
//   - the build target isn't macOS, or
//   - a real signing identity is configured (CSC_LINK / CSC_NAME present), in
//     which case electron-builder does proper signing + notarization and we
//     must not interfere.

const { execFileSync } = require('node:child_process');
const path = require('node:path');

/** @param {import('electron-builder').AfterPackContext} context */
exports.default = async function afterPack(context) {
	const { electronPlatformName, appOutDir, packager } = context;

	if (electronPlatformName !== 'darwin') return;

	// Real signing is happening — leave the app alone.
	if (process.env.CSC_LINK || process.env.CSC_NAME) {
		console.log('  • after-pack: real signing identity present, skipping ad-hoc sign');
		return;
	}

	const appName = `${packager.appInfo.productFilename}.app`;
	const appPath = path.join(appOutDir, appName);

	console.log(`  • after-pack: ad-hoc signing ${appName} (no Developer ID; avoids "damaged" on Apple Silicon)`);

	// --deep signs nested helpers/frameworks inside-out, which is required for a
	// valid bundle signature and is the standard ad-hoc fix. "-" = ad-hoc.
	execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
		stdio: 'inherit',
	});

	// Sanity-check the result so a broken signature fails the build loudly
	// rather than shipping another "damaged" artifact.
	execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
		stdio: 'inherit',
	});
};
