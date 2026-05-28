import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type EditorKind = 'cursor' | 'vscode';
export type TerminalKind = 'terminal' | 'iterm' | 'warp' | 'ghostty';

interface EditorDef {
  cli: string;
  // Common install paths to check when the CLI isn't on PATH. macOS-only for
  // now — these get skipped on other platforms.
  macFallbacks: string[];
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
  const [cursor, vscode] = await Promise.all([
    resolveBinary('cursor'),
    resolveBinary('vscode'),
  ]);
  return { cursor: cursor != null, vscode: vscode != null };
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
  // Bundle name(s) for `open -a`. The first match found is what we use.
  macApps: string[];
  // Common .app install paths to probe.
  macAppPaths: string[];
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
};

async function resolveTerminalApp(terminal: TerminalKind): Promise<string | null> {
  const def = TERMINALS[terminal];
  if (process.platform !== 'darwin') return null;
  for (const p of def.macAppPaths) {
    if (await exists(p)) return def.macApps[0];
  }
  return null;
}

export async function detectTerminals(): Promise<Record<TerminalKind, boolean>> {
  const kinds: TerminalKind[] = ['terminal', 'iterm', 'warp', 'ghostty'];
  const entries = await Promise.all(
    kinds.map(async (k) => [k, (await resolveTerminalApp(k)) != null] as const),
  );
  return Object.fromEntries(entries) as Record<TerminalKind, boolean>;
}

export async function openInTerminal(
  terminal: TerminalKind,
  target: string,
): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Opening in a terminal is only supported on macOS.' };
  }
  const appName = await resolveTerminalApp(terminal);
  if (!appName) {
    return { ok: false, error: `${terminal} is not installed.` };
  }
  try {
    const child = spawn('open', ['-a', appName, target], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {
      /* unref'd — swallow */
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
