import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Session, SessionSummary } from '@shared/types.js';

// Sessions live in a fixed, app-name-independent location so the standalone CLI
// and the Electron app resolve the same directory (Electron's userData path
// depends on the productName, which the CLI can't reliably reproduce). One JSON
// manifest per session, grouped by repo id.
//
//   ~/.super-review/sessions/<repoId>/<sessionId>.json
export function sessionsRoot(): string {
	return path.join(os.homedir(), '.super-review', 'sessions');
}

function repoDir(repoId: string): string {
	return path.join(sessionsRoot(), repoId);
}

function sessionPath(repoId: string, id: string): string {
	return path.join(repoDir(repoId), `${id}.json`);
}

// Drop the heavy per-file contents and tour steps so listings stay cheap; the
// summary keeps just the step count for the list to show.
function toSummary(session: Session): SessionSummary {
	const { files: _files, steps, ...rest } = session;
	return { ...rest, stepCount: steps?.length ?? 0 };
}

async function readSession(file: string): Promise<Session | null> {
	try {
		const raw = await fs.readFile(file, 'utf8');
		return JSON.parse(raw) as Session;
	} catch {
		// Missing or malformed manifest — skip it rather than failing the listing.
		return null;
	}
}

// All sessions for a repo, newest-updated first. Tolerates a missing directory
// (no sessions yet) and skips any manifest that won't parse.
export async function listSessions(repoId: string): Promise<SessionSummary[]> {
	let entries: string[];
	try {
		entries = await fs.readdir(repoDir(repoId));
	} catch {
		return [];
	}
	const sessions = await Promise.all(
		entries
			.filter((name) => name.endsWith('.json'))
			.map((name) => readSession(path.join(repoDir(repoId), name)))
	);
	return sessions
		.filter((s): s is Session => s !== null)
		.map(toSummary)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSession(repoId: string, id: string): Promise<Session | null> {
	return readSession(sessionPath(repoId, id));
}

// Find a session by its upsert key (the harness conversation/run id). Used by
// the CLI to decide between creating a new session and updating an existing one.
export async function findSessionByKey(repoId: string, key: string): Promise<Session | null> {
	let entries: string[];
	try {
		entries = await fs.readdir(repoDir(repoId));
	} catch {
		return null;
	}
	for (const name of entries) {
		if (!name.endsWith('.json')) continue;
		const session = await readSession(path.join(repoDir(repoId), name));
		if (session?.key === key) return session;
	}
	return null;
}

export async function writeSession(session: Session): Promise<void> {
	const dir = repoDir(session.repoId);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		sessionPath(session.repoId, session.id),
		JSON.stringify(session, null, 2),
		'utf8'
	);
}

export async function deleteSession(repoId: string, id: string): Promise<void> {
	await fs.rm(sessionPath(repoId, id), { force: true });
}
