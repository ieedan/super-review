import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The CLI has no GitHub auth of its own. Rather than bolt a second device-flow
// onto it, we reuse the login the desktop app already established: the app
// persists each account (token included) via electron-store as plaintext JSON.
// That token already sits unencrypted on disk readable by the user's own
// processes, so a CLI running as the same user reading it adds no new exposure.
// We only ever read it, keep it in memory for the request, and never print it.

// Mirrors the desktop's StoredGithubAccount (apps/desktop/src/main/store.ts) for
// just the fields we need. Other fields (scopes, signingKeyRegistered, ...) are
// ignored.
interface StoredAccount {
	id: string;
	login: string;
	token: string;
}

interface StoredConfig {
	githubAccounts?: Record<string, StoredAccount>;
	activeGithubAccountId?: string | null;
	// Legacy single-token field, kept for accounts authed before multi-account.
	githubToken?: string | null;
}

export interface DesktopGithubAuth {
	token: string;
	login?: string;
}

// electron-store writes to `<userData>/<name>.json`, where userData is
// `<appData>/<appName>`. We replicate that resolution without importing electron:
// appData per-platform, then the app's known directory names. The packaged app
// userData directory name varies by build: the packaged app uses productName
// ("Super Review"), but in dev Electron names it after the package
// ("@super-review/desktop"). We don't hardcode either; we scan appData for any
// of our directories instead (see findConfigFiles).
function appDataDir(): string {
	const home = os.homedir();
	if (process.platform === 'darwin') {
		return path.join(home, 'Library', 'Application Support');
	}
	if (process.platform === 'win32') {
		return process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
	}
	return process.env.XDG_CONFIG_HOME ?? path.join(home, '.config');
}

// The electron-store file is named after the store's `name` (currently
// "super-review"; "super-local-review" is a legacy name kept for older installs).
const STORE_FILES = ['super-review.json', 'super-local-review.json'];
// A userData dir is "ours" if its name mentions both super and review — matches
// "Super Review", "super-review", "@super-review", and the "...local..." renames.
function looksLikeOurDir(name: string): boolean {
	return /super/i.test(name) && /review/i.test(name);
}

// Every existing electron-store file that could be ours. `SUPER_REVIEW_CONFIG_PATH`
// overrides the search with an explicit path. Otherwise we scan appData one level
// deep (and into `@scope` dirs, since the dev build lives at
// `@super-review/desktop/...`) for our store files. Returns absolute paths.
function findConfigFiles(): string[] {
	const explicit = process.env.SUPER_REVIEW_CONFIG_PATH;
	if (explicit) return [explicit];

	const base = appDataDir();
	const dirs: string[] = [];
	let entries: string[] = [];
	try {
		entries = fs.readdirSync(base);
	} catch {
		return [];
	}
	for (const entry of entries) {
		if (!looksLikeOurDir(entry)) continue;
		const dir = path.join(base, entry);
		if (entry.startsWith('@')) {
			// Scoped package dir (dev): descend one more level (e.g. .../desktop).
			let subs: string[] = [];
			try {
				subs = fs.readdirSync(dir);
			} catch {
				continue;
			}
			for (const sub of subs) dirs.push(path.join(dir, sub));
		} else {
			dirs.push(dir);
		}
	}

	const files: string[] = [];
	for (const dir of dirs) {
		for (const name of STORE_FILES) {
			const file = path.join(dir, name);
			if (fs.existsSync(file)) files.push(file);
		}
	}
	return files;
}

function tokenFromConfig(config: StoredConfig): DesktopGithubAuth | null {
	const accounts = config.githubAccounts ?? {};
	const active = config.activeGithubAccountId ? accounts[config.activeGithubAccountId] : undefined;
	const account = active ?? Object.values(accounts).find((a) => a?.token);
	if (account?.token) return { token: account.token, login: account.login };
	if (config.githubToken) return { token: config.githubToken };
	return null;
}

// The desktop app's GitHub token for the active account, or null when the app
// isn't installed/signed in. When more than one config file has a token (e.g. an
// install survived a rename), the most recently written file wins, so the app
// the user is actually running is the one we follow.
export function getDesktopGithubToken(): DesktopGithubAuth | null {
	const candidates: { auth: DesktopGithubAuth; mtimeMs: number }[] = [];
	for (const file of findConfigFiles()) {
		try {
			const config = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredConfig;
			const auth = tokenFromConfig(config);
			if (auth) candidates.push({ auth, mtimeMs: fs.statSync(file).mtimeMs });
		} catch {
			// Missing or unreadable/corrupt — skip it.
		}
	}
	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return candidates[0]?.auth ?? null;
}
