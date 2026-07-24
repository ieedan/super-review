import { app } from 'electron';
import os from 'node:os';
import type { FeedbackInput, FeedbackResult } from '@super-review/core/types';
import { webBase } from './license/service.js';
import { getDeviceToken } from './store.js';

// A slow network shouldn't leave the dialog spinning indefinitely; the user can
// retry and their text is preserved either way.
const TIMEOUT_MS = 15_000;

/**
 * Sends in-app feedback to the Super Review backend.
 *
 * Deliberately does not require a license or a signed-in GitHub account: the
 * people most likely to need the feedback dialog are the ones something is
 * broken for. The device token is attached when we have one so the report can
 * be attributed, but its absence is not an error.
 *
 * App version and OS are read here rather than trusted from the renderer.
 */
export async function submitFeedback(input: FeedbackInput): Promise<FeedbackResult> {
	const token = getDeviceToken();

	let res: Response;
	try {
		res = await fetch(`${webBase()}/api/feedback`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(token ? { authorization: `Bearer ${token}` } : {})
			},
			body: JSON.stringify({
				category: input.category,
				title: input.title.trim(),
				body: input.body.trim(),
				email: input.email?.trim() || undefined,
				context: input.context,
				appVersion: app.getVersion(),
				platform: process.platform,
				osRelease: os.release(),
				// Enough to reproduce a platform-specific report without a round
				// trip: Apple silicon vs Intel, and which Electron/Chromium the
				// renderer bug actually happened on.
				arch: process.arch,
				electronVersion: process.versions.electron
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch {
		throw new Error("Couldn't reach the feedback service. Check your connection and try again.");
	}

	if (res.status === 429) {
		throw new Error("You've sent a lot of feedback recently. Try again in a little while.");
	}
	if (!res.ok) {
		throw new Error('Sending feedback failed. Please try again in a moment.');
	}

	const data = (await res.json().catch(() => null)) as { id?: string } | null;
	return { id: data?.id ?? '' };
}
