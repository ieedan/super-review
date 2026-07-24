import { app } from 'electron';
import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * App identity: the name the OS shows us under, and the directory our state
 * lives in. Both are set here, before anything else in the main process runs.
 *
 * This module MUST stay the first import in index.ts. electron-store resolves
 * `userData` inside its constructor and store.ts builds its Store at module
 * scope, so by the time index.ts's own body executes the path is already fixed.
 * ES imports evaluate before the importer's body, so this is the only window
 * where setPath still has any effect.
 *
 * Dev and packaged builds get different names on purpose. Releases carry the
 * Developer ID signature and dev builds are ad-hoc signed, and macOS binds
 * keychain ACLs to the signing identity. safeStorage (store.ts, for the license
 * device token) names its key item after app.getName(), so while both builds
 * answered to "Super Review" they fought over one item: whichever created it
 * owned it, and the other one raised an "allow access to your keychain" prompt
 * on every launch. Separate names mean separate key items and no prompts.
 */

const isDev = !app.isPackaged;

// Read before the rename below. userData defaults to appData + the app name, so
// this is the directory every build has used to date (named after the package
// name, since the old rename happened too late to move it). Reading it after
// setName would instead name a directory that has never existed.
const sharedDir = app.getPath('userData');
const devDir = path.join(path.dirname(sharedDir), `${path.basename(sharedDir)}-dev`);

// Also what macOS puts in the app menu and its About/Hide/Quit items, so a dev
// window is now labelled as one. Packaged builds keep electron-builder's
// productName.
app.setName(isDev ? 'Super Review Dev' : 'Super Review');

// Pin the location explicitly. The rename above happens early enough to drag the
// default userData along with it, and for a packaged build that would silently
// point an update at an empty directory: installs would come back with no repos,
// no accounts and no license. Packaged builds stay exactly where they are; only
// dev moves.
app.setPath('userData', isDev ? devDir : sharedDir);

if (isDev) seedDevDir(sharedDir, devDir);

/**
 * One-time seed for a dev build that has never run under its own directory: copy
 * the config it used to share with the packaged build, so moving out doesn't
 * drop the repos and preferences already set up there. The license slice is left
 * behind deliberately, since its device token is encrypted against the other
 * build's keychain item, which is the thing we're separating from. Dev starts
 * unlicensed and can activate on its own.
 */
function seedDevDir(from: string, to: string): void {
	if (existsSync(to)) return;
	try {
		mkdirSync(to, { recursive: true });
		const config = path.join(from, 'super-review.json');
		if (existsSync(config)) {
			const parsed = JSON.parse(readFileSync(config, 'utf8')) as Record<string, unknown>;
			delete parsed['license'];
			// Matches conf's own serializer, so the file stays diffable by hand.
			writeFileSync(path.join(to, 'super-review.json'), JSON.stringify(parsed, null, '\t'));
		}
		const settings = path.join(from, 'settings.json');
		if (existsSync(settings)) copyFileSync(settings, path.join(to, 'settings.json'));
	} catch {
		// A fresh dev profile is a fine fallback. Never block startup on this.
	}
}
