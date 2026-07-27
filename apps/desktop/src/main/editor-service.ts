import { spawn, type SpawnOptions } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type EditorKind = 'cursor' | 'vscode' | 'zed' | 'xcode' | 'visualstudio';
export type TerminalKind = 'terminal' | 'iterm' | 'warp' | 'ghostty' | 'cmd' | 'powershell';

interface EditorDef {
	cli: string;
	// Common install paths to check when the CLI isn't on PATH. macOS-only for
	// now — these get skipped on other platforms.
	macFallbacks: string[];
	// When set, detection on macOS requires this .app bundle to exist. Needed for
	// editors whose CLI ships separately from the app (e.g. Xcode's `xed` comes
	// with the Command Line Tools and is present even without Xcode installed).
	macAppBundle?: string;
}

const EDITORS: Record<EditorKind, EditorDef> = {
	cursor: {
		cli: 'cursor',
		macFallbacks: [
			'/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
			`${process.env.HOME}/Applications/Cursor.app/Contents/Resources/app/bin/cursor`
		]
	},
	vscode: {
		cli: 'code',
		macFallbacks: [
			'/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
			`${process.env.HOME}/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`
		]
	},
	zed: {
		cli: 'zed',
		macFallbacks: ['/Applications/Zed.app/Contents/MacOS/cli']
	},
	// `xed` opens a file/folder in Xcode but ships with the Command Line Tools, so
	// it's present even without Xcode. Gate on the app bundle to detect Xcode itself.
	xcode: {
		cli: 'xed',
		macFallbacks: [],
		macAppBundle: '/Applications/Xcode.app'
	},
	// Full Visual Studio is Windows-only; `devenv` is its CLI. No macOS bundle
	// exists, so on macOS this stays undetected (shown as "Not installed").
	visualstudio: {
		cli: 'devenv',
		macFallbacks: []
	}
};

async function which(cmd: string): Promise<string | null> {
	return await new Promise<string | null>((resolve) => {
		// Prefer the absolute where.exe path — Electron's PATH on Windows is
		// usually fine, but don't depend on System32 being searchable.
		const finder =
			process.platform === 'win32'
				? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe')
				: 'which';
		const child = spawn(finder, [cmd], {
			stdio: ['ignore', 'pipe', 'ignore'],
			windowsHide: true
		});
		let out = '';
		child.stdout.on('data', (b) => (out += String(b)));
		child.on('close', (code) => {
			if (code !== 0) {
				resolve(null);
				return;
			}
			const lines = out
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean);
			// Prefer a real .exe when `where` lists both (e.g. a shim and the binary).
			const exe = lines.find((l) => /\.exe$/i.test(l));
			resolve(exe || lines[0] || null);
		});
		child.on('error', () => resolve(null));
	});
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

// Well-known Windows install locations. Prefer the GUI .exe over the `bin\*.cmd`
// shim: Node's CreateProcess cannot run .cmd/.bat without a shell, which is why
// "Open in VS Code" previously did nothing on Windows even when detection worked.
function winFallbacks(editor: EditorKind): string[] {
	const local = process.env.LOCALAPPDATA;
	const pf = process.env.ProgramFiles;
	const out: string[] = [];
	const add = (...parts: Array<string | undefined>) => {
		if (parts.every((p): p is string => typeof p === 'string' && p.length > 0)) {
			out.push(path.join(...parts));
		}
	};

	switch (editor) {
		case 'vscode':
			add(local, 'Programs', 'Microsoft VS Code', 'Code.exe');
			add(pf, 'Microsoft VS Code', 'Code.exe');
			add(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
			add(pf, 'Microsoft VS Code', 'bin', 'code.cmd');
			break;
		case 'cursor':
			add(local, 'Programs', 'cursor', 'Cursor.exe');
			add(local, 'Programs', 'Cursor', 'Cursor.exe');
			add(local, 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd');
			add(local, 'Programs', 'Cursor', 'resources', 'app', 'bin', 'cursor.cmd');
			break;
		case 'zed':
			add(local, 'Programs', 'Zed', 'Zed.exe');
			add(local, 'Programs', 'zed', 'Zed.exe');
			break;
		case 'visualstudio':
		case 'xcode':
			// Visual Studio is resolved via vswhere; Xcode is macOS-only.
			break;
	}
	return out;
}

// `where` / PATH usually finds `code.cmd` / `cursor.cmd`. Map those shims to the
// sibling GUI executable when it exists so we can spawn without a shell.
async function preferWindowsExe(bin: string): Promise<string> {
	if (process.platform !== 'win32') return bin;
	if (/\.exe$/i.test(bin)) return bin;
	if (!/\.(cmd|bat)$/i.test(bin)) return bin;

	const binDir = path.dirname(bin);
	const appDir = path.dirname(binDir);
	const candidates = [
		path.join(appDir, 'Code.exe'),
		path.join(appDir, 'Cursor.exe'),
		path.join(appDir, 'Zed.exe'),
		path.join(binDir, path.basename(bin).replace(/\.(cmd|bat)$/i, '.exe'))
	];
	for (const c of candidates) {
		if (await exists(c)) return c;
	}
	return bin;
}

async function resolveViaVswhere(): Promise<string | null> {
	const vswhere = path.join(
		process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
		'Microsoft Visual Studio',
		'Installer',
		'vswhere.exe'
	);
	if (!(await exists(vswhere))) return null;

	return await new Promise<string | null>((resolve) => {
		// productPath is devenv.exe for IDE installs. Require CoreEditor so we
		// don't treat Build Tools-only installs as Visual Studio.
		const child = spawn(
			vswhere,
			[
				'-latest',
				'-products',
				'*',
				'-requires',
				'Microsoft.VisualStudio.Component.CoreEditor',
				'-property',
				'productPath'
			],
			{ stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
		);
		let out = '';
		child.stdout.on('data', (b) => (out += String(b)));
		child.on('close', (code) => {
			if (code !== 0) {
				resolve(null);
				return;
			}
			const line = out.split(/\r?\n/)[0]?.trim();
			resolve(line || null);
		});
		child.on('error', () => resolve(null));
	});
}

async function resolveVisualStudio(): Promise<string | null> {
	if (process.platform !== 'win32') {
		return which(EDITORS.visualstudio.cli);
	}

	const onPath = await which(EDITORS.visualstudio.cli);
	if (onPath) return onPath;

	const fromVswhere = await resolveViaVswhere();
	if (fromVswhere && (await exists(fromVswhere))) return fromVswhere;

	// Last resort: walk common year/edition installs. VS isn't on PATH for most
	// users, and older/custom layouts sometimes confuse vswhere.
	const years = ['2025', '2022', '2019'];
	const editions = ['Community', 'Professional', 'Enterprise'];
	const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(
		(r): r is string => typeof r === 'string' && r.length > 0
	);
	for (const root of roots) {
		for (const year of years) {
			for (const edition of editions) {
				const candidate = path.join(
					root,
					'Microsoft Visual Studio',
					year,
					edition,
					'Common7',
					'IDE',
					'devenv.exe'
				);
				if (await exists(candidate)) return candidate;
			}
		}
	}
	return null;
}

async function resolveBinary(editor: EditorKind): Promise<string | null> {
	if (editor === 'visualstudio') return resolveVisualStudio();

	const def = EDITORS[editor];
	if (def.macAppBundle && process.platform === 'darwin') {
		if (!(await exists(def.macAppBundle))) return null;
	}
	const onPath = await which(def.cli);
	if (onPath) return preferWindowsExe(onPath);
	if (process.platform === 'darwin') {
		for (const p of def.macFallbacks) {
			if (await exists(p)) return p;
		}
	}
	if (process.platform === 'win32') {
		for (const p of winFallbacks(editor)) {
			if (await exists(p)) return preferWindowsExe(p);
		}
	}
	return null;
}

export async function detectEditors(): Promise<Record<EditorKind, boolean>> {
	const [cursor, vscode, zed, xcode, visualstudio] = await Promise.all([
		resolveBinary('cursor'),
		resolveBinary('vscode'),
		resolveBinary('zed'),
		resolveBinary('xcode'),
		resolveBinary('visualstudio')
	]);
	return {
		cursor: cursor != null,
		vscode: vscode != null,
		zed: zed != null,
		xcode: xcode != null,
		visualstudio: visualstudio != null
	};
}

// Build the CLI args to open `target`, optionally jumping to `line`. Each editor
// has its own "go to line" syntax; Visual Studio's `devenv` has no simple one, so
// it (and any call without a line) just opens the file.
function editorArgs(editor: EditorKind, target: string, line?: number): string[] {
	if (line == null || !Number.isFinite(line) || line < 1) return [target];
	switch (editor) {
		case 'cursor':
		case 'vscode':
			// `-g`/`--goto` accepts file:line(:column).
			return ['-g', `${target}:${line}`];
		case 'zed':
			return [`${target}:${line}`];
		case 'xcode':
			return ['--line', String(line), target];
		case 'visualstudio':
			return [target];
	}
}

function spawnDetached(
	bin: string,
	args: string[],
	cwd?: string
): Promise<{ ok: boolean; error?: string }> {
	return new Promise((resolve) => {
		const opts: SpawnOptions = {
			detached: true,
			stdio: 'ignore',
			cwd,
			windowsHide: true
		};

		// Batch shims need a shell; GUI .exes do not.
		if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
			opts.shell = true;
		}

		let settled = false;
		const finish = (result: { ok: boolean; error?: string }) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		try {
			const child = spawn(bin, args, opts);
			child.on('error', (err) => {
				finish({ ok: false, error: err.message });
			});
			child.unref();
			// CreateProcess failures surface on 'error' in the next tick; if we
			// haven't heard by then, the process started.
			setImmediate(() => finish({ ok: true }));
		} catch (err) {
			finish({ ok: false, error: err instanceof Error ? err.message : String(err) });
		}
	});
}

export async function openInEditor(
	editor: EditorKind,
	target: string,
	line?: number
): Promise<{ ok: boolean; error?: string }> {
	const bin = await resolveBinary(editor);
	if (!bin) {
		return {
			ok: false,
			error:
				editor === 'visualstudio'
					? 'Visual Studio was not found. Install Visual Studio or add devenv to PATH.'
					: `${editor} CLI not found. Install the shell command from the editor's command palette, or reinstall the editor.`
		};
	}
	const cwd = path.dirname(target);
	return spawnDetached(bin, editorArgs(editor, target, line), cwd);
}

// Terminal apps are detected by presence of their .app bundle on macOS.
// `open -a <App> <path>` is what we use to launch — it opens a new window
// rooted at the directory.
interface TerminalDef {
	// macOS: bundle name(s) for `open -a`. The first match found is what we use.
	macApps?: string[];
	// macOS: common .app install paths to probe.
	macAppPaths?: string[];
	// Windows: executable to probe with `where` and to launch.
	winExe?: string;
}

const TERMINALS: Record<TerminalKind, TerminalDef> = {
	terminal: {
		macApps: ['Terminal'],
		macAppPaths: [
			'/System/Applications/Utilities/Terminal.app',
			'/Applications/Utilities/Terminal.app'
		]
	},
	iterm: {
		macApps: ['iTerm', 'iTerm2'],
		macAppPaths: ['/Applications/iTerm.app']
	},
	warp: {
		macApps: ['Warp'],
		macAppPaths: ['/Applications/Warp.app']
	},
	ghostty: {
		macApps: ['Ghostty'],
		macAppPaths: ['/Applications/Ghostty.app']
	},
	cmd: { winExe: 'cmd.exe' },
	powershell: { winExe: 'powershell.exe' }
};

async function isTerminalInstalled(terminal: TerminalKind): Promise<boolean> {
	const def = TERMINALS[terminal];
	if (process.platform === 'darwin') {
		for (const p of def.macAppPaths ?? []) {
			if (await exists(p)) return true;
		}
		return false;
	}
	if (process.platform === 'win32') {
		if (!def.winExe) return false;
		return (await which(def.winExe)) != null;
	}
	return false;
}

export async function detectTerminals(): Promise<Record<TerminalKind, boolean>> {
	const kinds = Object.keys(TERMINALS) as TerminalKind[];
	const entries = await Promise.all(
		kinds.map(async (k) => [k, await isTerminalInstalled(k)] as const)
	);
	return Object.fromEntries(entries) as Record<TerminalKind, boolean>;
}

export async function openInTerminal(
	terminal: TerminalKind,
	target: string
): Promise<{ ok: boolean; error?: string }> {
	if (!(await isTerminalInstalled(terminal))) {
		return { ok: false, error: `${terminal} is not installed.` };
	}
	try {
		if (process.platform === 'darwin') {
			const appName = TERMINALS[terminal].macApps?.[0];
			if (!appName) {
				return { ok: false, error: `${terminal} is not supported on macOS.` };
			}
			return spawnDetached('open', ['-a', appName, target]);
		}
		if (process.platform === 'win32') {
			const exe = TERMINALS[terminal].winExe;
			if (!exe) {
				return { ok: false, error: `${terminal} is not supported on Windows.` };
			}
			// `start` opens a new console window; with cwd set, the shell launches
			// rooted at the repo directory. The empty string is the window title.
			const args =
				terminal === 'powershell' ? ['/c', 'start', '', exe, '-NoExit'] : ['/c', 'start', '', exe];
			return spawnDetached('cmd.exe', args, target);
		}
		return {
			ok: false,
			error: 'Opening in a terminal is only supported on macOS and Windows.'
		};
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
