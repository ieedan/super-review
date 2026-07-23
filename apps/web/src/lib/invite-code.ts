/**
 * Where an invite code waits while the user is off at GitHub signing in.
 *
 * The code normally travels in the URL (`/dashboard?code=...`), through the
 * login redirect's `next` param. That relies on better-auth preserving a query
 * string on `callbackURL`, which its docs do not promise, so the login page also
 * stashes the code here and the dashboard falls back to it. Per-tab and
 * same-origin, so it survives the round trip without leaking into other tabs.
 */
export const INVITE_CODE_KEY = 'sr_pending_invite_code';

/** Reads and clears the stashed code. Client-only. */
export function takeStashedInviteCode(): string | null {
	try {
		const code = sessionStorage.getItem(INVITE_CODE_KEY);
		if (code) sessionStorage.removeItem(INVITE_CODE_KEY);
		return code;
	} catch {
		// Storage can be unavailable (private mode, blocked). The URL path still works.
		return null;
	}
}
