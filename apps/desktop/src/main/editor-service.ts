import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type EditorKind = 'cursor' | 'vscode' | 'zed' | 'xcode' | 'visualstudio';
export type TerminalKind =
  | 'terminal'
  | 'iterm'
  | 'warp'
  | 'ghostty'
  | 'cmd'
  | 'powershell';

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
      `${process.env.HOME}/Applications/Cursor.app/Contents/Resources/app/bin/cursor`,
    ],
  },
  vscode: {
    cli: 'code',
    macFallbacks: [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      `${process.env.HOME}/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`,
    ],
  },
  zed: {
    cli: 'zed',
    macFallbacks: ['/Applications/Zed.app/Contents/MacOS/cli'],
  },
  // `xed` opens a file/folder in Xcode but ships with the Command Line Tools, so
  // it's present even without Xcode. Gate on the app bundle to detect Xcode itself.
  xcode: {
    cli: 'xed',
    macFallbacks: [],
    macAppBundle: '/Applications/Xcode.app',
  },
  // Full Visual Studio is Windows-only; `devenv` is its CLI. No macOS bundle
  // exists, so on macOS this stays undetected (shown as "Not installed").
  visualstudio: {
    cli: 'devenv',
    macFallbacks: [],
  },
};

async function which(cmd: string): Promise<string | null> {
  return await new Promise<string | null>((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.on('data', (b) => (out += String(b)));
    child.on('close', (code) => {
      if (code === 0) {
        const line = out.split('\n')[0]?.trim();
        resolve(line || null);
      } else {
        resolve(null);
      }
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

async function resolveBinary(editor: EditorKind): Promise<string | null> {
  const def = EDITORS[editor];
  if (def.macAppBundle && process.platform === 'darwin') {
    if (!(await exists(def.macAppBundle))) return null;
  }
  const onPath = await which(def.cli);
  if (onPath) return onPath;
  if (process.platform === 'darwin') {
    for (const p of def.macFallbacks) {
      if (await exists(p)) return p;
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
    resolveBinary('visualstudio'),
  ]);
  return {
    cursor: cursor != null,
    vscode: vscode != null,
    zed: zed != null,
    xcode: xcode != null,
    visualstudio: visualstudio != null,
  };
}

export async function openInEditor(
  editor: EditorKind,
  target: string,
): Promise<{ ok: boolean; error?: string }> {
  const bin = await resolveBinary(editor);
  if (!bin) {
    return {
      ok: false,
      error: `${editor} CLI not found. Install the shell command from the editor's command palette.`,
    };
  }
  try {
    const cwd = path.dirname(target);
    const child = spawn(bin, [target], { detached: true, stdio: 'ignore', cwd });
    child.on('error', () => {
      /* unref'd — swallow */
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
      '/Applications/Utilities/Terminal.app',
    ],
  },
  iterm: {
    macApps: ['iTerm', 'iTerm2'],
    macAppPaths: ['/Applications/iTerm.app'],
  },
  warp: {
    macApps: ['Warp'],
    macAppPaths: ['/Applications/Warp.app'],
  },
  ghostty: {
    macApps: ['Ghostty'],
    macAppPaths: ['/Applications/Ghostty.app'],
  },
  cmd: { winExe: 'cmd.exe' },
  powershell: { winExe: 'powershell.exe' },
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
    kinds.map(async (k) => [k, await isTerminalInstalled(k)] as const),
  );
  return Object.fromEntries(entries) as Record<TerminalKind, boolean>;
}

export async function openInTerminal(
  terminal: TerminalKind,
  target: string,
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
      const child = spawn('open', ['-a', appName, target], {
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', () => {});
      child.unref();
      return { ok: true };
    }
    if (process.platform === 'win32') {
      const exe = TERMINALS[terminal].winExe;
      if (!exe) {
        return { ok: false, error: `${terminal} is not supported on Windows.` };
      }
      // `start` opens a new console window; with cwd set, the shell launches
      // rooted at the repo directory. The empty string is the window title.
      const args =
        terminal === 'powershell'
          ? ['/c', 'start', '', exe, '-NoExit']
          : ['/c', 'start', '', exe];
      const child = spawn('cmd.exe', args, {
        cwd: target,
        detached: true,
        stdio: 'ignore',
      });
      child.on('error', () => {});
      child.unref();
      return { ok: true };
    }
    return {
      ok: false,
      error: 'Opening in a terminal is only supported on macOS and Windows.',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
