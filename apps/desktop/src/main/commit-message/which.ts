import { spawn } from 'node:child_process';
import path from 'node:path';

// Resolve a CLI binary on PATH. Mirrors editor-service's which helper so harness
// detection behaves the same way as editor/terminal detection.
export async function which(cmd: string): Promise<string | null> {
	return await new Promise<string | null>((resolve) => {
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
			const exe = lines.find((l) => /\.exe$/i.test(l));
			const cmdShim = lines.find((l) => /\.(cmd|bat)$/i.test(l));
			const withExt = lines.find((l) => path.extname(l) !== '');
			resolve(exe || cmdShim || withExt || lines[0] || null);
		});
		child.on('error', () => resolve(null));
	});
}
