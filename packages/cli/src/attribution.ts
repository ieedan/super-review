import { getSession, harnessLabel, type HarnessKind } from '@super-review/core';
import { fail } from './util';

// The identity flags shared by `comment reply` and `comment resolve`. On the
// local store these set the comment's author; on a PR (where the GitHub author
// is the token owner, i.e. the human) they instead drive an attribution footer
// folded into the comment body.
export interface Identity {
	harness?: HarnessKind;
	name?: string;
	session?: string;
}

// The display name for the acting agent: an explicit --name wins, else the
// harness label, else a generic "Agent".
function actorName(id: Identity): string {
	if (id.name?.trim()) return id.name.trim();
	if (id.harness) return harnessLabel(id.harness);
	return 'Agent';
}

// Build the attribution line that gets appended to a PR comment body, e.g.
// "Reply from Claude Code ・ Super Review Session abc123". The session clause is
// dropped when no session was linked.
function attributionLine(verb: string, id: Identity): string {
	const parts = [`${verb} ${actorName(id)}`];
	if (id.session) parts.push(`Super Review Session ${id.session}`);
	return parts.join(' ・ ');
}

// Append the attribution footer to a PR comment body. We add it whenever the
// agent supplied any identity (harness, name, or session); a bare reply with no
// identity stays clean. `verb` reads naturally for the action ("Reply from",
// "Resolved by").
export function withAttribution(body: string, verb: string, id: Identity): string {
	const hasIdentity = Boolean(id.harness || id.name?.trim() || id.session);
	if (!hasIdentity) return body;
	const footer = attributionLine(verb, id);
	return body.trim() ? `${body.trim()}\n\n${footer}` : footer;
}

// Validate that a linked session id actually exists in this repo, so a typo
// doesn't leave a dead reference in the attribution footer. Mirrors the local
// `comment resolve` check.
export async function validateSession(root: string, sessionId: string | undefined): Promise<void> {
	if (!sessionId) return;
	const session = await getSession(root, sessionId);
	if (!session) fail(`no session with id "${sessionId}" in this repo`);
}
