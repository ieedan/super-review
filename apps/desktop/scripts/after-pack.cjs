// electron-builder afterPack hook: flip Electron fuses to harden the packaged
// app against the cheapest tampering (running our main process as plain Node,
// loading a modified/loose app directory, attaching a debugger).
//
// Runs BEFORE electron-builder signs/notarizes, so the flipped binary is what
// gets signed - the correct order for the mac hardened-runtime config.
//
// Note on asar integrity: electron-builder 25 embeds the asar integrity hash
// automatically for macOS, but NOT for Windows (that needs electron-builder
// >= 26). Enabling the integrity fuse without the hash resource makes the app
// refuse to boot, so we enable it on macOS only until the eb upgrade. The other
// fuses are safe cross-platform.
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
	const { electronPlatformName, appOutDir } = context;
	const appName = context.packager.appInfo.productFilename;

	let electronBinaryPath;
	if (electronPlatformName === 'darwin') {
		electronBinaryPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'MacOS', appName);
	} else if (electronPlatformName === 'win32') {
		electronBinaryPath = path.join(appOutDir, `${appName}.exe`);
	} else {
		electronBinaryPath = path.join(appOutDir, appName.toLowerCase());
	}

	const isMac = electronPlatformName === 'darwin';

	await flipFuses(electronBinaryPath, {
		version: FuseVersion.V1,
		// No `node app.js` mode - blocks ELECTRON_RUN_AS_NODE.
		[FuseV1Options.RunAsNode]: false,
		// Ignore NODE_OPTIONS / --inspect so the main process can't be driven.
		[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
		[FuseV1Options.EnableNodeCliInspectArguments]: false,
		// Only load the app from the asar archive (not a loose app directory).
		[FuseV1Options.OnlyLoadAppFromAsar]: true,
		// Reject a modified asar. macOS only under electron-builder 25 (see above).
		[FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: isMac,
		// The fuse flip invalidates the ad-hoc mac signature; let it be re-signed.
		resetAdHocDarwinSignature: isMac
	});
};
